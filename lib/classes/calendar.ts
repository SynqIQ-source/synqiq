import { DateTime } from "luxon";

// SynqIQ's class calendar: which classes happen on which dates, generated
// from the (edited) weekly schedules. Pure; unit-tested in
// tests/class-calendar.test.ts. lib/sync/class-calendar.ts saves it.

export type CalendarSchedule = {
  id: string;
  classTypeId: string | null;
  className: string;
  days: number[]; // 0 = Sunday
  startTime: string; // "06:05:00", studio-local
  endTime: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  frequencyInterval: number | null; // every N weeks (1 = weekly)
  resourceId: number | null;
  capacity: number | null;
  staffMindbodyId: number | null;
  mindbodyClassScheduleId: number | null;
};

export type GeneratedSession = {
  class_schedule_id: string;
  class_type_id: string | null;
  class_name: string;
  local_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  mindbody_resource_id: number | null;
  capacity: number | null;
  staff_mindbody_id: number | null;
  mindbody_class_schedule_id: number | null;
};

const normalizeTime = (value: string) => (value.length === 5 ? `${value}:00` : value.slice(0, 8));

// Studio-local date + time -> ISO instant (handles daylight saving).
export function toInstant(localDate: string, time: string, timezone: string): string {
  return DateTime.fromISO(`${localDate}T${normalizeTime(time)}`, { zone: timezone })
    .toUTC()
    .toISO()!;
}

// Weeks since the schedule's first week (weeks start Sunday).
function weekIndex(date: DateTime, start: DateTime) {
  const sunday = (value: DateTime) => value.minus({ days: value.weekday % 7 }).startOf("day");
  return Math.round(sunday(date).diff(sunday(start), "weeks").weeks);
}

export function generateSessions(schedules: CalendarSchedule[], from: string, to: string, timezone: string): GeneratedSession[] {
  const sessions: GeneratedSession[] = [];
  const first = DateTime.fromISO(from, { zone: timezone });
  const last = DateTime.fromISO(to, { zone: timezone });
  for (const schedule of schedules) {
    if (!schedule.days.length || !schedule.startTime || !schedule.endTime) continue;
    const interval = schedule.frequencyInterval && schedule.frequencyInterval > 1 ? schedule.frequencyInterval : 1;
    const anchor = schedule.startDate ? DateTime.fromISO(schedule.startDate, { zone: timezone }) : first;
    for (let date = first; date <= last; date = date.plus({ days: 1 })) {
      const iso = date.toISODate()!;
      if (schedule.startDate && iso < schedule.startDate) continue;
      if (schedule.endDate && iso > schedule.endDate) continue;
      if (!schedule.days.includes(date.weekday % 7)) continue;
      if (interval > 1 && weekIndex(date, anchor) % interval !== 0) continue;
      sessions.push({
        class_schedule_id: schedule.id,
        class_type_id: schedule.classTypeId,
        class_name: schedule.className,
        local_date: iso,
        start_time: normalizeTime(schedule.startTime),
        end_time: normalizeTime(schedule.endTime),
        starts_at: toInstant(iso, schedule.startTime, timezone),
        ends_at: toInstant(iso, schedule.endTime, timezone),
        mindbody_resource_id: schedule.resourceId,
        capacity: schedule.capacity,
        staff_mindbody_id: schedule.staffMindbodyId,
        mindbody_class_schedule_id: schedule.mindbodyClassScheduleId,
      });
    }
  }
  return sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.class_name.localeCompare(b.class_name));
}

// Compare a SynqIQ class with Mindbody's classes on the same local date
// (parallel run). `mindbodyClasses` must be that date's classes only.
export type MindbodyClass = { scheduleId: number | null; startsAt: string; staffMindbodyId: number | null };
export type CalendarMatch = "match" | "time_differs" | "instructor_differs" | "only_synqiq";

export function compareWithMindbody(
  session: { mindbody_class_schedule_id: number | null; starts_at: string; staff_mindbody_id: number | null },
  mindbodyClasses: MindbodyClass[],
): CalendarMatch {
  if (!session.mindbody_class_schedule_id) return "only_synqiq";
  const sameSchedule = mindbodyClasses.filter((cls) => cls.scheduleId === session.mindbody_class_schedule_id);
  if (!sameSchedule.length) return "only_synqiq";
  const match = sameSchedule.find((cls) => Date.parse(cls.startsAt) === Date.parse(session.starts_at));
  if (!match) return "time_differs";
  if (session.staff_mindbody_id && match.staffMindbodyId && session.staff_mindbody_id !== match.staffMindbodyId)
    return "instructor_differs";
  return "match";
}
