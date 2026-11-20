import { DateTime } from "luxon";

// Jan 1 cutover (Adam, 2026-11-19): every Mindbody autopay contract becomes a
// SynqIQ billing schedule. Each member KEEPS their Mindbody billing day;
// SynqIQ takes over every bill due on or after the cutover date (Mindbody
// keeps the ones before; Adam turns Mindbody's autopays off). Pure: works
// from a contract as synced from Mindbody.

export const DEFAULT_CUTOVER_DATE = "2027-01-01";

export type CutoverContract = {
  nextBillDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  autoRenewing: boolean;
  normalCents: number;
  nextSubtotalCents: number | null;
  nextTaxCents: number | null;
  upcoming: { date: string; subtotalCents?: number; taxCents?: number; totalCents?: number }[] | null;
};

export type CutoverPlan = {
  firstBillDate: string;
  billDay: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  remainingPayments: number | null; // null = continues until cancelled
  autoRenews: boolean;
  basis: "mindbody_schedule" | "monthly_from_next_bill";
};

// The same day each month, held at the month's last day when shorter
// (a 31st member bills on Feb 28).
export function monthlyOnDay(date: string, months: number, day: number): string {
  const month = DateTime.fromISO(date).plus({ months }).startOf("month");
  return month.set({ day: Math.min(day, month.daysInMonth ?? 28) }).toISODate()!;
}

export function planCutover(contract: CutoverContract, cutoverDate: string, taxRate: number): CutoverPlan | { exclude: string } {
  if (contract.endDate && contract.endDate < cutoverDate && !contract.autoRenewing) return { exclude: "Ends before the cutover" };

  // Mindbody's own upcoming payments: one per date (several products can
  // bill on the same date), only those with money due.
  const byDate = new Map<string, { subtotal: number; tax: number; total: number }>();
  for (const row of contract.upcoming ?? []) {
    if (!row?.date) continue;
    const day = row.date.slice(0, 10);
    const sum = byDate.get(day) ?? { subtotal: 0, tax: 0, total: 0 };
    sum.subtotal += Number(row.subtotalCents ?? 0);
    sum.tax += Number(row.taxCents ?? 0);
    sum.total += Number(row.totalCents ?? Number(row.subtotalCents ?? 0) + Number(row.taxCents ?? 0));
    byDate.set(day, sum);
  }
  const after = [...byDate.entries()].filter(([date, sum]) => date >= cutoverDate && sum.total > 0).sort(([a], [b]) => a.localeCompare(b));
  if (after.length) {
    const [firstBillDate, amount] = after[0];
    return {
      firstBillDate,
      billDay: Number(firstBillDate.slice(8, 10)),
      subtotalCents: amount.subtotal,
      taxCents: amount.tax,
      totalCents: amount.total,
      remainingPayments: contract.autoRenewing ? null : after.length,
      autoRenews: contract.autoRenewing,
      basis: "mindbody_schedule",
    };
  }

  // No Mindbody payments listed after the cutover: a renewing contract keeps
  // billing monthly on its next bill day.
  if (!contract.autoRenewing) return { exclude: "No payments due after the cutover" };
  if (!contract.nextBillDate) return { exclude: "No next bill date in Mindbody" };
  const subtotal = contract.nextSubtotalCents ?? contract.normalCents;
  if (!(subtotal > 0)) return { exclude: "$0 autopay" };
  const tax =
    contract.nextSubtotalCents != null && contract.nextTaxCents != null && contract.nextSubtotalCents === subtotal
      ? contract.nextTaxCents
      : Math.round(subtotal * taxRate);
  const day = Number(contract.nextBillDate.slice(8, 10));
  let months = 0;
  let date = contract.nextBillDate;
  while (date < cutoverDate && months < 24) date = monthlyOnDay(contract.nextBillDate, ++months, day);
  return {
    firstBillDate: date,
    billDay: day,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    remainingPayments: null,
    autoRenews: true,
    basis: "monthly_from_next_bill",
  };
}
