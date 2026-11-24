import { DateTime } from "luxon";
import { PAY_PERIOD_ANCHOR, periodContaining } from "@/lib/trainer/pilot-rules";

// The pay period dates the payroll pages share: two weeks, Saturday to
// Friday, counted from the anchor. ?from=&to= (YYYY-MM-DD) picks any range;
// with none, the last full pay period.

export function payPeriodPresets(timezone: string) {
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const current = periodContaining(today, PAY_PERIOD_ANCHOR);
  const dayBefore = DateTime.fromISO(current.startsOn).minus({ days: 1 }).toISODate()!;
  const last = periodContaining(dayBefore, PAY_PERIOD_ANCHOR);
  return {
    current: { from: current.startsOn, to: current.endsOn },
    last: { from: last.startsOn, to: last.endsOn },
  };
}

export function resolvePayRange(params: { from?: string; to?: string }, timezone: string) {
  const valid = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const presets = payPeriodPresets(timezone);
  const from = valid(params.from) ?? presets.last.from;
  const to = valid(params.to) && valid(params.to)! >= from ? valid(params.to)! : from === presets.last.from ? presets.last.to : from;
  return { from, to, presets };
}

// Studio-day range as UTC instants: [start of `from`, start of the day after `to`).
export function rangeInstants(from: string, to: string, timezone: string) {
  return {
    startIso: DateTime.fromISO(from, { zone: timezone }).startOf("day").toUTC().toISO()!,
    endIso: DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!,
  };
}
