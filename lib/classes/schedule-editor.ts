import { DateTime } from "luxon";

// The schedule editor: validates a new class series (one or more time rows)
// and finds room / instructor clashes. Pure; unit-tested in
// tests/schedule-editor.test.ts. app/api/class-schedules saves it.

export type TimeRowInput = {
  days?: unknown; // 0 = Sunday (recurring only)
  startTime?: unknown; // "HH:mm"
  endTime?: unknown;
  everyWeeks?: unknown;
  staffId?: unknown;
  assistantId?: unknown;
  payOverrideCents?: unknown;
  assistantPayCents?: unknown;
  roomId?: unknown;
  layoutId?: unknown;
};

export type SeriesInput = {
  kind?: unknown; // "recurring" | "single"
  startDate?: unknown;
  endDate?: unknown; // optional; never required
  rows?: unknown;
  capacity?: unknown;
  waitlistCapacity?: unknown;
  onlineBooking?: unknown;
  onlineCapacity?: unknown;
  isFree?: unknown;
  payLater?: unknown;
};

export type SeriesRow = {
  days: number[];
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string | null;
  frequency_type: "Weekly" | "Single";
  frequency_interval: number;
  staff_id: string | null;
  assistant_staff_id: string | null;
  pay_override_cents: number | null;
  assistant_pay_cents: number | null;
  room_id: string | null;
  layout_id: string | null;
  capacity: number;
  waitlist_capacity: number | null;
  online_capacity: number | null; // null = every spot; 0 = not bookable online
  is_free: boolean;
  pay_later: boolean;
};

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:00)?$/;

const uuidOrNull = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value : null);
function intOrNull(value: unknown, min: number, max: number): number | null | "bad" {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) return "bad";
  return number;
}
const time = (value: unknown) => (typeof value === "string" && TIME.test(value) ? `${value.slice(0, 5)}:00` : null);
const validDate = (value: unknown): value is string => typeof value === "string" && DATE.test(value) && DateTime.fromISO(value).isValid;

export function validateSeries(input: SeriesInput, today: string): { ok: true; rows: SeriesRow[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const single = input.kind === "single";
  if (!validDate(input.startDate)) return fail(single ? "Pick the date." : "Pick a start date.");
  if (input.startDate < today) return fail("The start date can't be in the past.");
  let endDate: string | null = null;
  if (!single && input.endDate !== null && input.endDate !== undefined && input.endDate !== "") {
    if (!validDate(input.endDate)) return fail("The end date isn't valid.");
    if (input.endDate < input.startDate) return fail("The end date must be on or after the start date.");
    endDate = input.endDate;
  }
  const capacity = intOrNull(input.capacity, 1, 500);
  if (capacity === null || capacity === "bad") return fail("Spots must be 1 to 500.");
  const waitlist = intOrNull(input.waitlistCapacity, 0, 200);
  if (waitlist === "bad") return fail("Waitlist size must be 0 to 200.");
  const online = input.onlineBooking === false ? 0 : intOrNull(input.onlineCapacity, 0, 500);
  if (online === "bad") return fail("Online spots must be 0 to 500.");
  if (online !== null && online > capacity) return fail("Online spots can't be more than the class's spots.");
  if (!Array.isArray(input.rows) || !input.rows.length) return fail("Add at least one time.");
  if (input.rows.length > 14) return fail("Too many times at once.");

  const rows: SeriesRow[] = [];
  for (const [index, raw] of (input.rows as TimeRowInput[]).entries()) {
    const label = input.rows.length > 1 ? `Time ${index + 1}: ` : "";
    const start = time(raw?.startTime);
    const end = time(raw?.endTime);
    if (!start || !end) return fail(`${label}Pick the start and end times.`);
    if (end <= start) return fail(`${label}The class has to end after it starts.`);
    let days: number[];
    if (single) {
      days = [DateTime.fromISO(input.startDate).weekday % 7];
    } else {
      if (!Array.isArray(raw.days) || raw.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
        return fail(`${label}Pick valid days.`);
      days = [...new Set(raw.days as number[])].sort();
      if (!days.length) return fail(`${label}Pick at least one day.`);
    }
    const every = single ? 1 : intOrNull(raw.everyWeeks, 1, 12);
    if (every === "bad") return fail(`${label}Repeat every 1 to 12 weeks.`);
    const pay = intOrNull(raw.payOverrideCents, 0, 100000);
    const assistantPay = intOrNull(raw.assistantPayCents, 0, 100000);
    if (pay === "bad" || assistantPay === "bad") return fail(`${label}Pay must be $0 to $1,000.`);
    const staffId = uuidOrNull(raw.staffId);
    const assistantId = uuidOrNull(raw.assistantId);
    if (assistantId && assistantId === staffId) return fail(`${label}The assistant can't be the instructor.`);
    if (!assistantId && assistantPay !== null) return fail(`${label}Pick the assistant, or clear their pay.`);
    const roomId = uuidOrNull(raw.roomId);
    const layoutId = roomId ? uuidOrNull(raw.layoutId) : null;
    rows.push({
      days,
      start_time: start,
      end_time: end,
      start_date: input.startDate,
      end_date: single ? input.startDate : endDate,
      frequency_type: single ? "Single" : "Weekly",
      frequency_interval: every ?? 1,
      staff_id: staffId,
      assistant_staff_id: assistantId,
      pay_override_cents: pay,
      assistant_pay_cents: assistantId ? assistantPay : null,
      room_id: roomId,
      layout_id: layoutId,
      capacity,
      waitlist_capacity: waitlist,
      online_capacity: online,
      is_free: input.isFree === true,
      pay_later: input.payLater === true && input.isFree !== true,
    });
  }
  return { ok: true, rows };
}

// Existing classes on the calendar that a new date overlaps: same room, or
// same instructor / assistant.
export type BusyClass = {
  className: string;
  localDate: string;
  startTime: string;
  endTime: string;
  roomId: string | null;
  staffIds: string[];
};
export type Clash = { date: string; time: string; with: string; reason: "room" | "instructor" };

export function findClashes(
  planned: { localDate: string; startTime: string; endTime: string; roomId: string | null; staffIds: string[] }[],
  busy: BusyClass[],
): Clash[] {
  const clashes: Clash[] = [];
  for (const date of planned) {
    for (const other of busy) {
      if (other.localDate !== date.localDate) continue;
      if (!(date.startTime < other.endTime && other.startTime < date.endTime)) continue;
      const sameRoom = Boolean(date.roomId && date.roomId === other.roomId);
      const sameStaff = date.staffIds.some((id) => other.staffIds.includes(id));
      if (!sameRoom && !sameStaff) continue;
      clashes.push({
        date: date.localDate,
        time: `${other.startTime.slice(0, 5)}–${other.endTime.slice(0, 5)}`,
        with: other.className,
        reason: sameRoom ? "room" : "instructor",
      });
    }
  }
  return clashes;
}

// The day before a date (ending a series when it changes from that date).
export const dayBefore = (date: string) => DateTime.fromISO(date).minus({ days: 1 }).toISODate()!;
