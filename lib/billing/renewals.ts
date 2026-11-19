import { DateTime } from "luxon";

// Monthly membership billing rules (Adam, 2026-11-19). SynqIQ runs its own
// renewals: each billing date it charges the member's saved card off-session
// on the studio's Stripe account (lib/payments). These are the rules the
// nightly run, the POS and the member flags share.
//
// - Billing start: the sign-up day (default; bills on that day each month),
//   or prorated: the first payment covers the rest of this month and the
//   dues are drafted on the 1st from next month.
// - Declines: retried 3, 6 and 10 days after the billing date. If the last
//   retry fails the membership is frozen (no booking) and the member shows red.
// - Expiring cards: a member whose card expires within a month shows yellow,
//   and gets an email then and again 15 days later.

export type BillingStart = "signup" | "prorated";

export const RETRY_DAYS = [3, 6, 10] as const;
export const CARD_WARNING_MONTHS = 1;
export const CARD_SECOND_NOTICE_DAYS = 15;

const day = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

// The first monthly draft after a sale on `saleDate`.
export function firstBillDate(start: BillingStart, saleDate: string): string {
  const sale = day(saleDate);
  return (start === "prorated" ? sale.startOf("month").plus({ months: 1 }) : sale.plus({ months: 1 })).toISODate()!;
}

// Prorated dues for the rest of the month, sale day included: a $200 month
// bought on Nov 21 of 30 days covers 10 days = $66.67. Bought on the 1st it's
// the full month.
export function proratedCents(monthlyCents: number, saleDate: string): number {
  const sale = day(saleDate);
  const daysInMonth = sale.daysInMonth!;
  const daysLeft = daysInMonth - sale.day + 1;
  return Math.round((monthlyCents * daysLeft) / daysInMonth);
}

// The parts of a membership package's first payment: with proration, the
// recurring parts (dues) are prorated; one-off parts (registration) stay.
export function firstPaymentParts<T extends { amountCents: number; recurring: boolean }>(
  parts: T[],
  start: BillingStart,
  saleDate: string,
): T[] {
  if (start !== "prorated") return parts;
  return parts.map((part) => (part.recurring ? { ...part, amountCents: proratedCents(part.amountCents, saleDate) } : part));
}

// What happens after a declined attempt on a charge due `dueDate`.
// `attempts` counts the tries so far, the first one on the billing date.
export function afterDecline(dueDate: string, attempts: number): { retryOn: string } | { freeze: true } {
  const offset = RETRY_DAYS[attempts - 1];
  if (offset === undefined) return { freeze: true };
  return { retryOn: day(dueDate).plus({ days: offset }).toISODate()! };
}

// Cards expire at the end of their expiry month.
export function cardExpiresOn(expMonth: number, expYear: number): string {
  return DateTime.utc(expYear, expMonth, 1).endOf("month").toISODate()!;
}

export type CardExpiry = {
  state: "ok" | "expiring" | "expired";
  expiresOn: string;
  firstNoticeOn: string; // a month before it expires
  secondNoticeOn: string; // 15 days after that
};

export function cardExpiry(expMonth: number, expYear: number, today: string): CardExpiry {
  const expiresOn = cardExpiresOn(expMonth, expYear);
  const firstNoticeOn = day(expiresOn).minus({ months: CARD_WARNING_MONTHS }).toISODate()!;
  const secondNoticeOn = day(firstNoticeOn).plus({ days: CARD_SECOND_NOTICE_DAYS }).toISODate()!;
  const state = today > expiresOn ? "expired" : today >= firstNoticeOn ? "expiring" : "ok";
  return { state, expiresOn, firstNoticeOn, secondNoticeOn };
}

// Which expiring-card email is due today, if any. A card added late in the
// window still gets the first notice, then the second 15 days on.
export function cardNoticeDue(
  expiry: CardExpiry,
  sent: { first: boolean; second: boolean },
  today: string,
  firstSentOn?: string | null,
): "first" | "second" | null {
  if (expiry.state === "ok") return null;
  if (!sent.first) return "first";
  if (sent.second) return null;
  const secondOn = firstSentOn ? day(firstSentOn).plus({ days: CARD_SECOND_NOTICE_DAYS }).toISODate()! : expiry.secondNoticeOn;
  return today >= secondOn ? "second" : null;
}

export type BillingFlag = "red" | "yellow" | null;

// Red: a payment failed every retry (booking frozen). Yellow: card expiring
// within a month (or already expired). Red wins.
export function billingFlag(input: { frozen: boolean; card: CardExpiry | null }): BillingFlag {
  if (input.frozen) return "red";
  if (input.card && input.card.state !== "ok") return "yellow";
  return null;
}
