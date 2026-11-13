import { DateTime } from "luxon";

// Billing test (practice renewals). Pure; unit-tested in
// tests/practice-billing.test.ts.
//
// A member's Mindbody contract is imported once into a SynqIQ payment
// schedule (its first billing date, amount and term). From then on SynqIQ
// works out every billing date itself. On each date it records a practice
// charge (nothing is charged) and checks it against what Mindbody actually
// charged (the synced Mindbody sales).
//
// Mindbody's pattern (checked on real contracts): a contract bills on its
// start date and on the same day each month while the date is before its
// end date; a renewing contract carries on monthly after that.

export type ImportableContract = {
  startDate: string | null;
  endDate: string | null;
  autoRenewing: boolean;
  normalCents: number;
  nextSubtotalCents: number | null;
  nextTaxCents: number | null;
};

// Payments in the term: start, start + 1 month, ... while before the end.
export function termPaymentCount(startDate: string, endDate: string | null): number | null {
  if (!endDate) return null;
  const start = DateTime.fromISO(startDate);
  let count = 0;
  while (start.plus({ months: count }).toISODate()! < endDate && count < 600) count += 1;
  return count;
}

export function scheduleFromContract(contract: ImportableContract, taxRate: number) {
  if (!contract.startDate) return null;
  const subtotal = contract.nextSubtotalCents ?? contract.normalCents;
  const tax = contract.nextTaxCents ?? Math.round(subtotal * taxRate);
  return {
    firstBillDate: contract.startDate,
    autopayCount: termPaymentCount(contract.startDate, contract.endDate),
    autoRenews: contract.autoRenewing,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
  };
}

// Every billing date from the first through `upTo` (inclusive): monthly from
// the first date (counted from it, so the 31st stays the 31st where it
// exists), stopping after `count` unless it renews.
export function billingDatesThrough(firstBillDate: string, count: number | null, autoRenews: boolean, upTo: string): string[] {
  const first = DateTime.fromISO(firstBillDate);
  const out: string[] = [];
  for (let k = 0; k < 600; k += 1) {
    if (count != null && !autoRenews && k >= count) break;
    const date = first.plus({ months: k }).toISODate()!;
    if (date > upTo) break;
    out.push(date);
  }
  return out;
}

export type MindbodyCharge = { detailId: number; day: string; totalCents: number; description: string; contractId: number | null };
export type ChargeResult = "match" | "date_differs" | "amount_differs" | "not_charged" | "pending";

// Mindbody retries declined autopays for 7 days, so a charge up to a week
// after the due date (or a few days before) still counts as the same one.
const EARLY_DAYS = 3;
const LATE_DAYS = 7;

export function matchPracticeCharge(
  charge: { dueDate: string; totalCents: number; contractIds: number[]; name: string },
  mindbody: MindbodyCharge[],
  today: string,
  taken: Set<number>,
): { result: ChargeResult; match: MindbodyCharge | null } {
  const due = DateTime.fromISO(charge.dueDate);
  const from = due.minus({ days: EARLY_DAYS }).toISODate()!;
  const to = due.plus({ days: LATE_DAYS }).toISODate()!;
  const sameName = (description: string) => description.trim().toLowerCase() === charge.name.trim().toLowerCase();
  const candidates = mindbody
    .filter((row) => !taken.has(row.detailId) && row.day >= from && row.day <= to)
    .filter((row) => (row.contractId != null && charge.contractIds.includes(row.contractId)) || sameName(row.description))
    .sort(
      (a, b) =>
        Number(b.totalCents === charge.totalCents) - Number(a.totalCents === charge.totalCents) ||
        Math.abs(due.diff(DateTime.fromISO(a.day), "days").days) - Math.abs(due.diff(DateTime.fromISO(b.day), "days").days),
    );
  const hit = candidates[0];
  if (hit) {
    if (hit.totalCents !== charge.totalCents) return { result: "amount_differs", match: hit };
    return { result: hit.day === charge.dueDate ? "match" : "date_differs", match: hit };
  }
  return { result: today > to ? "not_charged" : "pending", match: null };
}

export const RESULT_LABELS: Record<ChargeResult, string> = {
  match: "Matches Mindbody",
  date_differs: "Same amount, different day",
  amount_differs: "Different amount",
  not_charged: "Mindbody didn't charge",
  pending: "Waiting for Mindbody",
};
