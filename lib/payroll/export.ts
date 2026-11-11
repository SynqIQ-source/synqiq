import { DateTime } from "luxon";
import type { PayrollPerson } from "@/lib/payroll/report";

// Payroll export in the same columns as the Mindbody payroll export the
// studio sends to its payroll provider: one row per class, one row per person
// per session type (sessions in "Students"), and one row each for hourly pay
// and commission.
export const EXPORT_COLUMNS = [
  "Co Code",
  "Batch ID",
  "File Number",
  "Emp Name",
  "Class Name",
  "Class Date",
  "Weekday",
  "Start Time",
  "End Time",
  "Students",
  "Earnings Amt",
  "Payment Code",
] as const;

const cell = (value: string | number | null | undefined) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const dollars = (cents: number) => (cents / 100).toFixed(2);

export function payrollRows(people: PayrollPerson[], timezone: string, batchId = ""): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const at = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(timezone) : null);
  for (const person of people) {
    if (person.commissionCents !== 0) {
      rows.push(["NA", batchId, "", person.name, "Commission", "", "", "", "", "", dollars(person.commissionCents), ""]);
    }
    if (person.hourly.amountCents > 0) {
      rows.push(["NA", batchId, "", person.name, "Hourly Pay", "", "", "", "", "", dollars(person.hourly.amountCents), ""]);
    }
    for (const item of person.classes) {
      if (item.amountCents === 0) continue;
      const start = at(item.startsAt)!;
      const end = at(item.endsAt);
      rows.push([
        "",
        batchId,
        "",
        person.name,
        item.name.trim(),
        start.toFormat("M/d/yyyy"),
        start.toFormat("cccc"),
        start.toFormat("h:mm a"),
        end ? end.toFormat("h:mm a") : "",
        item.heads,
        dollars(item.amountCents),
        "",
      ]);
    }
    const byType = new Map<string, { count: number; cents: number; last: string; lastEnd: string | null }>();
    for (const session of person.sessions) {
      const entry = byType.get(session.sessionType) ?? { count: 0, cents: 0, last: session.startsAt, lastEnd: session.endsAt };
      entry.count += 1;
      entry.cents += session.amountCents;
      if (session.startsAt >= entry.last) {
        entry.last = session.startsAt;
        entry.lastEnd = session.endsAt;
      }
      byType.set(session.sessionType, entry);
    }
    for (const [type, entry] of byType) {
      if (entry.cents === 0) continue;
      const start = at(entry.last)!;
      const end = at(entry.lastEnd);
      rows.push([
        "",
        batchId,
        "",
        person.name,
        type,
        start.toFormat("M/d/yyyy"),
        start.toFormat("cccc"),
        start.toFormat("h:mm a"),
        end ? end.toFormat("h:mm a") : "",
        entry.count,
        dollars(entry.cents),
        "",
      ]);
    }
  }
  return rows;
}

export function payrollCsv(people: PayrollPerson[], timezone: string, batchId = ""): string {
  return [EXPORT_COLUMNS as readonly string[], ...payrollRows(people, timezone, batchId)]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
