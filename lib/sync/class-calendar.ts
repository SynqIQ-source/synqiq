import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { generateSessions, type CalendarSchedule } from "@/lib/classes/calendar";

// Builds SynqIQ's class calendar (class_sessions) for the booking window
// from the class schedules with their SynqIQ edits. Runs after the nightly
// catalog import and whenever a class type or class time is created or
// edited. Single-date edits (class_sessions.edits) are never overwritten:
// a date that drops out of the weekly pattern is deleted, or flagged
// "removed from schedule" if it was edited or has bookings.

export const CALENDAR_DAYS = 21; // the booking window
const RUNNING_DAYS = 30; // a Mindbody schedule counts if it had a class this recently

export type BuildCalendarResult =
  { success: true; sessions: number; removed: number; flagged: number; from: string; to: string } | { success: false; error: string };

type ScheduleRow = {
  id: string;
  source: string;
  class_type_id: string | null;
  class_name: string | null;
  days: number[];
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  frequency_interval: number | null;
  mindbody_resource_id: number | null;
  capacity: number | null;
  staff_mindbody_id: number | null;
  mindbody_class_schedule_id: number | null;
  last_class_at: string | null;
  edits: Record<string, CatalogValue> | null;
};

export async function buildClassCalendar(organizationId: string): Promise<BuildCalendarResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: org } = await supabase.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
    const timezone = (org?.timezone as string | null) ?? "America/Chicago";
    const today = DateTime.now().setZone(timezone);
    const from = today.toISODate()!;
    const to = today.plus({ days: CALENDAR_DAYS }).toISODate()!;

    const [{ data: scheduleRows, error }, { data: typeRows }] = await Promise.all([
      supabase
        .from("class_schedules")
        .select(
          "id, source, class_type_id, class_name, days, start_time, end_time, start_date, end_date, frequency_interval, mindbody_resource_id, capacity, staff_mindbody_id, mindbody_class_schedule_id, last_class_at, edits",
        )
        .eq("organization_id", organizationId)
        .returns<ScheduleRow[]>(),
      supabase.from("class_types").select("id, name, active, edits").eq("organization_id", organizationId),
    ]);
    if (error) throw new Error(error.message);
    const types = new Map(
      (typeRows ?? []).map((row) => [
        row.id as string,
        effective("class_type", row as { id: string; name: string; active: boolean; edits: Record<string, CatalogValue> | null }),
      ]),
    );
    const runningSince = today.minus({ days: RUNNING_DAYS }).toMillis();

    const schedules: CalendarSchedule[] = [];
    for (const row of scheduleRows ?? []) {
      const schedule = effective("class_schedule", row);
      if (schedule.active === false) continue;
      if (row.source === "mindbody" && !(row.last_class_at && Date.parse(row.last_class_at) >= runningSince)) continue;
      const type = row.class_type_id ? types.get(row.class_type_id) : undefined;
      if (type && type.active === false && row.source === "synqiq") continue;
      schedules.push({
        id: row.id,
        classTypeId: row.class_type_id,
        className: (type?.name as string | undefined) ?? row.class_name ?? "Class",
        days: (schedule.days as number[]) ?? [],
        startTime: schedule.start_time as string,
        endTime: schedule.end_time as string,
        startDate: (schedule.start_date as string | null) ?? null,
        endDate: (schedule.end_date as string | null) ?? null,
        frequencyInterval: row.frequency_interval,
        resourceId: (schedule.mindbody_resource_id as number | null) ?? null,
        capacity: (schedule.capacity as number | null) ?? null,
        staffMindbodyId: (schedule.staff_mindbody_id as number | null) ?? null,
        mindbodyClassScheduleId: row.mindbody_class_schedule_id,
      });
    }

    const generated = generateSessions(schedules, from, to, timezone);
    const generatedAt = new Date().toISOString();
    for (let index = 0; index < generated.length; index += 500) {
      const { error: saveError } = await supabase.from("class_sessions").upsert(
        generated.slice(index, index + 500).map((session) => ({
          ...session,
          organization_id: organizationId,
          generated_at: generatedAt,
          removed_from_schedule_at: null,
        })),
        { onConflict: "class_schedule_id,local_date" },
      );
      if (saveError) throw new Error(`Saving the calendar failed: ${saveError.message}`);
    }

    // Dates in the window the weekly pattern no longer has.
    const keep = new Set(generated.map((session) => `${session.class_schedule_id}|${session.local_date}`));
    const { data: existing } = await supabase
      .from("class_sessions")
      .select("id, class_schedule_id, local_date, edits, removed_from_schedule_at")
      .eq("organization_id", organizationId)
      .gte("local_date", from)
      .lte("local_date", to);
    const stale = (existing ?? []).filter((row) => !keep.has(`${row.class_schedule_id}|${row.local_date}`));
    // Classes with bookings are never deleted, only flagged.
    const booked = new Set<string>();
    const staleIds = stale.map((row) => row.id as string);
    for (let index = 0; index < staleIds.length; index += 200) {
      const { data: bookingRows } = await supabase
        .from("class_bookings")
        .select("class_session_id")
        .in("class_session_id", staleIds.slice(index, index + 200));
      for (const booking of bookingRows ?? []) booked.add(booking.class_session_id as string);
    }
    const keepRow = (row: (typeof stale)[number]) =>
      (row.edits && Object.keys(row.edits as object).length > 0) || booked.has(row.id as string);
    const toDelete = stale.filter((row) => !keepRow(row)).map((row) => row.id as string);
    const toFlag = stale.filter((row) => keepRow(row) && !row.removed_from_schedule_at).map((row) => row.id as string);
    for (let index = 0; index < toDelete.length; index += 200) {
      await supabase
        .from("class_sessions")
        .delete()
        .in("id", toDelete.slice(index, index + 200));
    }
    if (toFlag.length) await supabase.from("class_sessions").update({ removed_from_schedule_at: generatedAt }).in("id", toFlag);

    return { success: true, sessions: generated.length, removed: toDelete.length, flagged: toFlag.length, from, to };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
