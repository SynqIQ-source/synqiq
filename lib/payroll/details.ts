import { classPayCents, type PayRate } from "@/lib/payroll/rates";

// Pure helpers for the payroll detail reports (Sessions Serviced, Class Pay,
// Timesheets, Commission Report). Money is integer cents. Unit-tested in
// tests/payroll-details.test.ts.

// A class's pay split into the base and the incentive bonus (the per-person
// amount above the people included in the base, up to the cap). Pay set on
// the class time, a flat rate and "nobody came" pay are all base.
export function classPaySplit(
  rate: PayRate | null | undefined,
  paidHeads: number,
  overrideCents: number | null,
): { baseCents: number; incentiveCents: number; amountCents: number } {
  if (overrideCents !== null) return { baseCents: overrideCents, incentiveCents: 0, amountCents: overrideCents };
  if (!rate) return { baseCents: 0, incentiveCents: 0, amountCents: 0 };
  const amountCents = classPayCents(rate, paidHeads);
  if (rate.method === "flat" || (paidHeads <= 0 && rate.noRegistrationCents != null)) {
    return { baseCents: amountCents, incentiveCents: 0, amountCents };
  }
  const baseCents = Math.min(rate.baseCents, amountCents);
  return { baseCents, incentiveCents: amountCents - baseCents, amountCents };
}

// Short label for a rate column: "65%", "$20 flat", "$40 + $5/person over 6".
export function rateDetail(rate: PayRate | null | undefined): string | null {
  if (!rate) return null;
  const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  if (rate.method === "percent") return `${rate.percent ?? 0}%`;
  if (rate.method === "flat") return `${money(rate.flatCents ?? 0)} flat`;
  if (!rate.perHeadCents) return `${money(rate.baseCents)} base`;
  const cap = rate.capCents == null ? "" : `, max ${money(rate.capCents)}`;
  return `${money(rate.baseCents)} + ${money(rate.perHeadCents)}/person over ${rate.headsAbove}${cap}`;
}

// Where a session falls in the client's package: the Nth session used, and how
// many were left after it. `visits` are the client's visits on that package
// (any order); a visit counts when it used a session (attended, a no-show, or
// a charged late cancel). `since` is the package's start date.
export type PackVisit = { key: string; start: string; usedSession: boolean };
export function packPosition(
  total: number | null,
  since: string | null,
  visits: PackVisit[],
  target: { key: string; start: string },
): { used: number; left: number } | null {
  if (total == null || total <= 0) return null;
  const used = visits.filter(
    (visit) =>
      (visit.usedSession || visit.key === target.key) &&
      (since == null || visit.start.slice(0, 10) >= since) &&
      (visit.start < target.start || (visit.start === target.start && visit.key <= target.key)),
  ).length;
  return { used, left: Math.max(0, total - used) };
}

// Rows grouped by person (sorted by name), with each person's total.
export function byPerson<T extends { staffId: string; staffName: string; amountCents: number }>(rows: T[]) {
  const groups = new Map<string, { staffId: string; staffName: string; rows: T[]; totalCents: number }>();
  for (const row of rows) {
    const group = groups.get(row.staffId) ?? { staffId: row.staffId, staffName: row.staffName, rows: [], totalCents: 0 };
    group.rows.push(row);
    group.totalCents += row.amountCents;
    groups.set(row.staffId, group);
  }
  return [...groups.values()].sort((a, b) => a.staffName.localeCompare(b.staffName));
}

// Hourly pay for a total of minutes, rounded to the cent.
export function hourlyPayCents(minutes: number, rateCents: number | null): number {
  return rateCents == null ? 0 : Math.round((minutes * rateCents) / 60);
}

export const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
