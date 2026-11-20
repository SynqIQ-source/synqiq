import { DateTime } from "luxon";

// Jan 1 cutover (Adam, 2026-11-19): every Mindbody autopay contract becomes a
// SynqIQ billing schedule. Each member KEEPS their Mindbody billing day;
// SynqIQ takes over every bill due on or after the cutover date (Mindbody
// keeps the ones before; Adam turns Mindbody's autopays off). Pure: works
// from a contract as synced from Mindbody.

export const DEFAULT_CUTOVER_DATE = "2027-01-01";

export type CutoverContract = {
  nextBillDate: string | null; // YYYY-MM-DD
  startDate?: string | null;
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
  // assumed_renewal: Mindbody hasn't generated the next 12 months yet (it does
  // ~45 days out); the contract is assumed to renew on its usual day and amount.
  basis: "mindbody_schedule" | "monthly_from_next_bill" | "assumed_renewal";
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
  // billing monthly on its next bill day. Mindbody runs every membership in
  // 12-month terms and generates the next term ~45 days before the end, so a
  // renewing contract with no next bill yet is assumed to renew (Adam,
  // 2026-11-19) on its usual day (the term's start/end day).
  if (!contract.autoRenewing) return { exclude: "No payments due after the cutover" };
  const anchor = contract.nextBillDate ?? contract.endDate ?? contract.startDate ?? null;
  if (!anchor) return { exclude: "No billing day in Mindbody" };
  const assumed = !contract.nextBillDate;
  const subtotal = assumed ? contract.normalCents : (contract.nextSubtotalCents ?? contract.normalCents);
  if (!(subtotal > 0)) return { exclude: "$0 autopay" };
  const tax =
    contract.nextSubtotalCents != null && contract.nextTaxCents != null && contract.nextSubtotalCents === subtotal
      ? contract.nextTaxCents
      : Math.round(subtotal * taxRate);
  const day = Number(anchor.slice(8, 10));
  let months = 0;
  let date = anchor;
  while (date < cutoverDate && months < 60) date = monthlyOnDay(anchor, ++months, day);
  return {
    firstBillDate: date,
    billDay: day,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    remainingPayments: null,
    autoRenews: true,
    basis: assumed ? "assumed_renewal" : "monthly_from_next_bill",
  };
}
