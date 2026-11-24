// Trainer sessions pilot: pure rules (no database). Unit-tested in
// tests/trainer-pilot-rules.test.ts. Money is whole cents; percentages are
// basis points (6500 = 65.00%) or whole percents -- never floats in storage.

import { DateTime } from "luxon";

// --- Pay ------------------------------------------------------------------------

export type SessionRate = {
  method: "percent" | "flat";
  percentBp: number | null; // of the session's value
  flatCents: number | null;
};

// What the trainer earns for one closed session: the rate, scaled by the
// studio's no-show / late-cancel percent (100 for a completed session).
// Integer maths, rounded half up to the cent.
export function sessionPayCents(rate: SessionRate | null, valueCents: number | null, payPercent: number): number {
  if (!rate) return 0;
  const pct = Math.max(0, Math.min(100, Math.round(payPercent)));
  const base =
    rate.method === "flat"
      ? Math.max(0, rate.flatCents ?? 0)
      : Math.floor((Math.max(0, valueCents ?? 0) * Math.max(0, rate.percentBp ?? 0) + 5_000) / 10_000);
  return Math.floor((base * pct + 50) / 100);
}

export type ClosedStatus = "completed" | "no_show" | "late_cancelled";

// The share of the normal pay a closed session earns (studio settings).
export function payPercentFor(status: ClosedStatus, settings: { noShowPercent: number; lateCancelPercent: number }): number {
  if (status === "no_show") return settings.noShowPercent;
  if (status === "late_cancelled") return settings.lateCancelPercent;
  return 100;
}

// --- Rates (effective-dated) ----------------------------------------------------

export type DatedRate = SessionRate & {
  id: string;
  staffId: string;
  sessionTypeId: number | null; // null = the trainer's default
  effectiveFrom: string; // yyyy-mm-dd
};

// The one rule for which rate pays a session: the latest rate for that trainer
// and session type in effect on the session's date, else the trainer's latest
// default rate in effect then. (When pay moves to the session type instead of
// the trainer, this is the function to change.)
export function pickRate(rates: DatedRate[], staffId: string, sessionTypeId: number | null, date: string): DatedRate | null {
  const live = rates
    .filter((rate) => rate.staffId === staffId && rate.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return (
    (sessionTypeId != null ? live.find((rate) => rate.sessionTypeId === sessionTypeId) : undefined) ??
    live.find((rate) => rate.sessionTypeId == null) ??
    null
  );
}

// The Club Admin's rate form, parsed into cents / basis points with string
// arithmetic (no floating point): "65" or "62.5" percent, "20" or "20.50"
// dollars.
export function rateInputProblem(input: { method: string; percent: string; flatDollars: string; effectiveFrom: string }):
  | { error: string }
  | { method: "percent" | "flat"; percentBp: number | null; flatCents: number | null; effectiveFrom: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || !DateTime.fromISO(input.effectiveFrom).isValid)
    return { error: "Pick the date the rate starts." };
  const twoDecimals = (text: string) => {
    const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
    return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
  };
  if (input.method === "percent") {
    const bp = twoDecimals(input.percent);
    if (bp == null || bp <= 0 || bp > 10_000) return { error: "Enter a percent between 0 and 100 (up to 2 decimals)." };
    return { method: "percent", percentBp: bp, flatCents: null, effectiveFrom: input.effectiveFrom };
  }
  if (input.method === "flat") {
    const cents = twoDecimals(input.flatDollars);
    if (cents == null || cents > 1_000_000) return { error: "Enter a dollar amount up to $10,000 (up to 2 decimals)." };
    return { method: "flat", percentBp: null, flatCents: cents, effectiveFrom: input.effectiveFrom };
  }
  return { error: "Pick percent of the session's value or a flat amount." };
}

// --- Session value ----------------------------------------------------------------

// One session of a pack bought at SynqIQ's checkout: the pre-tax amount paid
// for those lines divided by the sessions they gave.
export function sessionValueCents(lines: { totalCents: number; taxCents: number }[], sessions: number): number | null {
  if (!Number.isInteger(sessions) || sessions <= 0) return null;
  const preTax = lines.reduce((sum, line) => sum + (line.totalCents - line.taxCents), 0);
  if (preTax < 0) return null;
  return Math.floor((preTax + Math.floor(sessions / 2)) / sessions);
}

// --- Pay periods --------------------------------------------------------------------

// Two-week periods, Saturday to Friday, counted from the studio's known start
// (the same periods as the Payroll page).
export const PAY_PERIOD_ANCHOR = "2026-10-24";
export const PAY_PERIOD_DAYS = 14;

export function periodContaining(date: string, anchor = PAY_PERIOD_ANCHOR): { startsOn: string; endsOn: string } {
  const start = DateTime.fromISO(anchor, { zone: "utc" });
  const day = DateTime.fromISO(date, { zone: "utc" });
  const index = Math.floor(day.diff(start, "days").days / PAY_PERIOD_DAYS);
  const from = start.plus({ days: index * PAY_PERIOD_DAYS });
  return { startsOn: from.toISODate()!, endsOn: from.plus({ days: PAY_PERIOD_DAYS - 1 }).toISODate()! };
}

export const nextPeriodStart = (period: { endsOn: string }) =>
  DateTime.fromISO(period.endsOn, { zone: "utc" }).plus({ days: 1 }).toISODate()!;

// Where a pay line for `date` goes: its own period, or -- if that one is
// locked -- the first period after it that isn't.
export function targetPeriodStart(date: string, lockedStarts: Set<string>, anchor = PAY_PERIOD_ANCHOR): string {
  let period = periodContaining(date, anchor);
  for (let guard = 0; guard < 520 && lockedStarts.has(period.startsOn); guard += 1) {
    period = periodContaining(nextPeriodStart(period), anchor);
  }
  return period.startsOn;
}

// --- Double-booking ------------------------------------------------------------------

export type Span = { id: string; startsAt: string; endsAt: string };
const ms = (iso: string) => Date.parse(iso);
export const spansOverlap = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) =>
  ms(a.startsAt) < ms(b.endsAt) && ms(b.startsAt) < ms(a.endsAt);

// The room and the client can't be in two places at once. (The trainer's own
// overlaps are handled by checkBooking: only the trainer or a Club Admin can
// double-book them, with a reason, as Mindbody allowed.) `sharedSlot` lets a
// semi-private session at the same start share the room.
export function placeConflicts(input: {
  slot: { startsAt: string; endsAt: string };
  roomBusy: (Span & { sharedSlot?: boolean })[];
  clientBusy: Span[];
}): string | null {
  if (input.clientBusy.some((other) => spansOverlap(input.slot, other))) return "The client already has a session then.";
  if (input.roomBusy.some((other) => !other.sharedSlot && spansOverlap(input.slot, other))) return "The room is already booked then.";
  return null;
}

// --- Reconciliation (SynqIQ vs Mindbody) ------------------------------------------------

export type SynqClosed = {
  id: string;
  trainerId: string;
  clientId: string;
  date: string;
  status: string; // completed | no_show | late_cancelled | cancelled | booked
  sessionType: string;
};
export type MindbodyVisit = {
  id: string;
  trainerId: string | null;
  clientId: string;
  date: string;
  status: string; // Mindbody: Completed, Arrived, NoShow, LateCancelled, Booked, Confirmed, Cancelled...
  sessionType: string;
};

export type ReconRow =
  | { kind: "match"; synq: SynqClosed; mindbody: MindbodyVisit; statusDiffers: boolean }
  | { kind: "synq_only"; synq: SynqClosed }
  | { kind: "mindbody_only"; mindbody: MindbodyVisit };

const mindbodyStatus = (status: string) => {
  const s = status.toLowerCase();
  if (s === "completed" || s === "arrived") return "completed";
  if (s === "noshow") return "no_show";
  if (s === "latecancelled") return "late_cancelled";
  if (s === "cancelled") return "cancelled";
  return "booked";
};

// Pair each SynqIQ session with a Mindbody visit for the same trainer, client
// and day (each visit used once). Leftovers on either side are differences.
export function reconcile(synq: SynqClosed[], mindbody: MindbodyVisit[]): ReconRow[] {
  const pool = [...mindbody];
  const rows: ReconRow[] = [];
  for (const session of [...synq].sort((a, b) => a.date.localeCompare(b.date))) {
    const index = pool.findIndex(
      (visit) => visit.clientId === session.clientId && visit.date === session.date && visit.trainerId === session.trainerId,
    );
    if (index === -1) {
      rows.push({ kind: "synq_only", synq: session });
      continue;
    }
    const [visit] = pool.splice(index, 1);
    rows.push({ kind: "match", synq: session, mindbody: visit, statusDiffers: mindbodyStatus(visit.status) !== session.status });
  }
  for (const visit of pool) rows.push({ kind: "mindbody_only", mindbody: visit });
  return rows;
}
