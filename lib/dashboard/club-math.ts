import { DateTime } from "luxon";

// Club Overview math: pure, so the page and the tests share it. Everything
// is computed from SynqIQ's own records (checkout sales, membership billing
// schedules and billing adjustments, front-desk check-ins, guest visits,
// maintenance reports) -- never Mindbody's. Dates are the studio's local
// calendar days ("yyyy-MM-dd").

// --- periods -----------------------------------------------------------------

export type Periods = {
  today: string;
  mtdFrom: string; // 1st of this month
  mtdTo: string; // today
  priorFrom: string; // 1st of last month
  priorTo: string; // same day last month (clamped to its last day)
  thirtyDaysAgo: string;
};

export function periodsFor(today: string): Periods {
  const day = DateTime.fromISO(today);
  const lastMonth = day.minus({ months: 1 });
  return {
    today,
    mtdFrom: day.startOf("month").toISODate()!,
    mtdTo: today,
    priorFrom: lastMonth.startOf("month").toISODate()!,
    priorTo: lastMonth.set({ day: Math.min(day.day, lastMonth.daysInMonth!) }).toISODate()!,
    thirtyDaysAgo: day.minus({ days: 30 }).toISODate()!,
  };
}

// "+12 (+8%)" style comparison; null when there's nothing to compare.
export function change(current: number, previous: number) {
  const diff = current - previous;
  return { diff, percent: previous > 0 ? Math.round((diff / previous) * 1000) / 10 : null };
}

const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

// --- members -------------------------------------------------------------------

export type Schedule = {
  id: string;
  clientId: string;
  name: string; // the member's name on the membership ("" if unknown)
  membership: string; // what was sold
  status: string; // practice | active | cancelled | voided
  startDate: string;
  endDate: string | null;
  createdDay: string; // local day the membership was sold
  voided: boolean;
};

export type Adjustment = {
  id: string;
  clientId: string;
  kind: string; // freeze | cancel | (others ignored)
  startsOn: string;
  endsOn: string | null;
  createdDay: string; // local day it was entered
  cancelledDay: string | null; // local day it was taken back
};

const countsAsSold = (schedule: Schedule, includePractice: boolean) =>
  !schedule.voided &&
  (schedule.status === "active" || schedule.status === "cancelled" || (includePractice && schedule.status === "practice"));

// A membership in force on a day (sold, started, not ended), before freezes
// and cancellations are applied.
function inForce(schedule: Schedule, day: string, includePractice: boolean) {
  return countsAsSold(schedule, includePractice) && schedule.startDate <= day && (!schedule.endDate || schedule.endDate >= day);
}

// Is this adjustment in effect on that day? (Taken back on/before it -> no.)
function liveOn(adjustment: Adjustment, day: string) {
  if (adjustment.cancelledDay && adjustment.cancelledDay <= day) return false;
  if (adjustment.startsOn > day) return false;
  return adjustment.kind === "cancel" || !adjustment.endsOn || adjustment.endsOn >= day;
}

// Members on a day: people with a membership in force, split into active
// (billing) and frozen. Cancelled ones (cancellation in effect) count as
// neither.
export function membersOn(schedules: Schedule[], adjustments: Adjustment[], day: string, includePractice: boolean) {
  const withMembership = new Set(schedules.filter((s) => inForce(s, day, includePractice)).map((s) => s.clientId));
  const cancelled = new Set(adjustments.filter((a) => a.kind === "cancel" && liveOn(a, day)).map((a) => a.clientId));
  const frozenNow = new Set(adjustments.filter((a) => a.kind === "freeze" && liveOn(a, day)).map((a) => a.clientId));
  const active = new Set<string>();
  const frozen = new Set<string>();
  for (const client of withMembership) {
    if (cancelled.has(client)) continue;
    (frozenNow.has(client) ? frozen : active).add(client);
  }
  return { active, frozen };
}

// What changed in a period: memberships sold, cancellations ENTERED (by the
// day staff entered them, not the day they take effect), freezes starting,
// freezes ending (or taken back), and the net.
export function memberMovement(schedules: Schedule[], adjustments: Adjustment[], from: string, to: string, includePractice: boolean) {
  const live = adjustments.filter((a) => !a.cancelledDay || a.cancelledDay > a.createdDay);
  const sold = schedules.filter((s) => countsAsSold(s, includePractice) && inRange(s.createdDay, from, to));
  const cancelled = live.filter((a) => a.kind === "cancel" && inRange(a.createdDay, from, to) && !(a.cancelledDay && a.cancelledDay <= to));
  const frozen = live.filter((a) => a.kind === "freeze" && inRange(a.startsOn, from, to));
  const unfrozen = live.filter((a) => {
    if (a.kind !== "freeze") return false;
    // Taken back early, or the freeze's last day passed within the period.
    if (a.cancelledDay && inRange(a.cancelledDay, from, to)) return true;
    if (!a.endsOn) return false;
    const backOn = DateTime.fromISO(a.endsOn).plus({ days: 1 }).toISODate()!;
    return inRange(backOn, from, to);
  });
  return {
    sold,
    cancelled,
    frozen,
    unfrozen,
    net: sold.length - cancelled.length - frozen.length + unfrozen.length,
  };
}

// --- sales ---------------------------------------------------------------------

export type SaleLine = { saleId: string; day: string; category: string; totalCents: number };

export function sumCents(lines: { totalCents: number }[]) {
  return lines.reduce((sum, line) => sum + line.totalCents, 0);
}

// Totals per revenue category, biggest first.
export function byCategory(lines: SaleLine[]) {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.category, (totals.get(line.category) ?? 0) + line.totalCents);
  return [...totals.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
}

// --- guest traffic heat map ------------------------------------------------------

export const HEAT_HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 6 AM .. 9 PM
export const HEAT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// visits per [hour row][weekday column] (Mon..Sun); visits before 6 AM or
// after 9:59 PM are counted in `outside`.
export function heatmap(visitTimes: string[], zone: string) {
  const grid = HEAT_HOURS.map(() => HEAT_DAYS.map(() => 0));
  let outside = 0;
  let max = 0;
  for (const iso of visitTimes) {
    const at = DateTime.fromISO(iso).setZone(zone);
    const row = at.hour - HEAT_HOURS[0];
    if (row < 0 || row >= HEAT_HOURS.length) {
      outside += 1;
      continue;
    }
    const value = (grid[row][at.weekday - 1] += 1);
    if (value > max) max = value;
  }
  return { grid, outside, max };
}

// --- maintenance -----------------------------------------------------------------

export type IssueRow = { status: string; createdAt: string; resolvedAt: string | null };

// Open reports: brand new (nobody has acted yet) vs in progress, and how
// many days they've been down on average.
export function maintenanceSummary(issues: IssueRow[], now: DateTime) {
  const open = issues.filter((issue) => !issue.resolvedAt && issue.status !== "resolved");
  const fresh = open.filter((issue) => issue.status === "reported").length;
  const days = open.map((issue) => Math.max(0, now.diff(DateTime.fromISO(issue.createdAt), "days").days));
  return {
    downNew: fresh,
    downInProgress: open.length - fresh,
    avgDaysDown: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
  };
}
