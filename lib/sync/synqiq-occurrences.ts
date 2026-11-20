import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { toInstant } from "@/lib/classes/calendar";

// Classes scheduled in SynqIQ (class_schedules.source = 'synqiq') get class
// records (class_occurrences) like Mindbody's, keyed by their class date, so
// dashboards, payroll, substitutions, the heat map, ratings, milestones and
// Follow Up see them. Counts come from SynqIQ's bookings; check-ins arrive
// through synqiq_signed_in (trigger), so total_signed_in stays 0 here.
// Runs after every calendar build and with the 15-minute count refresh.

const LOOKBACK_DAYS = 35;
const AHEAD_DAYS = 22;
const ACTIVE = new Set(["booked", "checked_in", "no_show"]);

export async function syncSynqiqOccurrences(organizationId: string) {
  const admin = createSupabaseAdminClient();
  const { data: schedules } = await admin.from("class_schedules").select("id").eq("organization_id", organizationId).eq("source", "synqiq");
  const scheduleIds = (schedules ?? []).map((row) => row.id as string);
  if (!scheduleIds.length) return { upserted: 0, removed: 0 };

  const from = DateTime.now().minus({ days: LOOKBACK_DAYS }).toUTC().toISO()!;
  const to = DateTime.now().plus({ days: AHEAD_DAYS }).toUTC().toISO()!;
  const sessions: Record<string, unknown>[] = [];
  for (let index = 0; index < scheduleIds.length; index += 100) {
    const { data } = await admin
      .from("class_sessions")
      .select("*")
      .eq("organization_id", organizationId)
      .in("class_schedule_id", scheduleIds.slice(index, index + 100))
      .gte("starts_at", from)
      .lte("starts_at", to);
    sessions.push(...(data ?? []));
  }
  if (!sessions.length) return { upserted: 0, removed: 0 };

  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const [{ data: staffRows }, { data: roomRows }, { data: typeRows }, { data: programRows }] = await Promise.all([
    admin.from("staff").select("id, display_name, mindbody_staff_id").eq("organization_id", organizationId),
    admin.from("rooms").select("id, mindbody_resource_id").eq("organization_id", organizationId),
    admin.from("class_types").select("id, mindbody_program_id").eq("organization_id", organizationId),
    admin.from("departments").select("id, mindbody_program_id").eq("organization_id", organizationId),
  ]);
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  const staffByMindbody = new Map(
    (staffRows ?? []).filter((row) => row.mindbody_staff_id).map((row) => [Number(row.mindbody_staff_id), row.id as string]),
  );
  const roomByMindbody = new Map((roomRows ?? []).map((row) => [Number(row.mindbody_resource_id), row.id as string]));
  const programOfType = new Map((typeRows ?? []).map((row) => [row.id as string, row.mindbody_program_id as number | null]));
  const departmentByProgram = new Map((programRows ?? []).map((row) => [Number(row.mindbody_program_id), row.id as string]));

  // SynqIQ's bookings per date.
  const counts = new Map<string, { booked: number; waitlist: number; early: number; late: number }>();
  const ids = sessions.map((row) => row.id as string);
  for (let index = 0; index < ids.length; index += 200) {
    const { data } = await admin
      .from("class_bookings")
      .select("class_session_id, status")
      .in("class_session_id", ids.slice(index, index + 200));
    for (const booking of data ?? []) {
      const entry = counts.get(booking.class_session_id as string) ?? { booked: 0, waitlist: 0, early: 0, late: 0 };
      if (ACTIVE.has(booking.status as string)) entry.booked += 1;
      if (booking.status === "waitlisted") entry.waitlist += 1;
      if (booking.status === "cancelled") entry.early += 1;
      if (booking.status === "late_cancelled") entry.late += 1;
      counts.set(booking.class_session_id as string, entry);
    }
  }

  // Adopted Mindbody series (schedule takeover): while Mindbody still reports a
  // date (its class sync, until it's switched off), that date keeps
  // Mindbody's record -- no second record for the same class.
  const mindbodyDates = new Set<string>();
  const adoptedIds = [...new Set(sessions.map((row) => row.mindbody_class_schedule_id).filter(Boolean))] as number[];
  for (let index = 0; index < adoptedIds.length; index += 200) {
    const { data } = await admin
      .from("class_occurrences")
      .select("mindbody_class_schedule_id, start_datetime")
      .eq("organization_id", organizationId)
      .not("mindbody_occurrence_id", "is", null)
      .in("mindbody_class_schedule_id", adoptedIds.slice(index, index + 200))
      .gte("start_datetime", from)
      .lte("start_datetime", to);
    for (const row of data ?? [])
      mindbodyDates.add(`${Number(row.mindbody_class_schedule_id)}|${Date.parse(row.start_datetime as string)}`);
  }

  const rows: Record<string, unknown>[] = [];
  const gone: string[] = [];
  for (const raw of sessions) {
    if (
      raw.mindbody_class_schedule_id &&
      mindbodyDates.has(`${Number(raw.mindbody_class_schedule_id)}|${Date.parse(raw.starts_at as string)}`)
    ) {
      gone.push(raw.id as string);
      continue;
    }
    const session = effective("class_session", raw as Record<string, unknown> & { edits: Record<string, CatalogValue> | null });
    if (session.active === false || raw.removed_from_schedule_at) {
      gone.push(raw.id as string);
      continue;
    }
    const scheduled =
      (raw.staff_id as string | null) ?? (raw.staff_mindbody_id ? (staffByMindbody.get(Number(raw.staff_mindbody_id)) ?? null) : null);
    // A different instructor on this date (sub or manual change).
    const dateTeacherMindbody = (session.staff_mindbody_id as number | null) ?? null;
    const dateTeacher =
      dateTeacherMindbody !== raw.staff_mindbody_id && dateTeacherMindbody ? (staffByMindbody.get(dateTeacherMindbody) ?? null) : null;
    const teacher = dateTeacher ?? scheduled;
    const program = raw.class_type_id ? programOfType.get(raw.class_type_id as string) : null;
    const capacity = (session.capacity as number | null) ?? null;
    const count = counts.get(raw.id as string) ?? { booked: 0, waitlist: 0, early: 0, late: 0 };
    const roomMindbody = (session.mindbody_resource_id as number | null) ?? null;
    // A single-date time change moves the class.
    const startsAt =
      session.start_time === raw.start_time
        ? (raw.starts_at as string)
        : toInstant(raw.local_date as string, String(session.start_time), timezone);
    const endsAt =
      session.end_time === raw.end_time ? (raw.ends_at as string) : toInstant(raw.local_date as string, String(session.end_time), timezone);
    rows.push({
      organization_id: organizationId,
      class_session_id: raw.id,
      mindbody_class_schedule_id: null,
      mindbody_occurrence_id: null,
      class_name: raw.class_name,
      instructor_name: teacher ? (staffName.get(teacher) ?? null) : null,
      staff_id: scheduled,
      substitution: Boolean(dateTeacher && dateTeacher !== scheduled),
      substitute_staff_id: dateTeacher && dateTeacher !== scheduled ? dateTeacher : null,
      department_id: program != null ? (departmentByProgram.get(Number(program)) ?? null) : null,
      room_id: roomMindbody != null ? (roomByMindbody.get(roomMindbody) ?? null) : null,
      start_datetime: startsAt,
      end_datetime: endsAt,
      max_capacity: capacity,
      web_capacity: (raw.online_capacity as number | null) ?? capacity,
      total_booked: count.booked,
      total_signed_in: 0,
      waitlist_count: count.waitlist,
      early_cancel_count: count.early,
      late_cancel_count: count.late,
      fill_rate: capacity ? Math.round((count.booked / capacity) * 10000) / 10000 : null,
      pay_override_cents: (raw.pay_override_cents as number | null) ?? null,
      assistant_staff_id: (raw.assistant_staff_id as string | null) ?? null,
      assistant_pay_cents: (raw.assistant_pay_cents as number | null) ?? null,
    });
  }

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await admin.from("class_occurrences").upsert(rows.slice(index, index + 500), { onConflict: "class_session_id" });
    if (error) throw new Error(`Saving SynqIQ class records failed: ${error.message}`);
  }
  // Cancelled or removed dates drop out (their bookings stay on the date).
  if (gone.length) await admin.from("class_occurrences").delete().in("class_session_id", gone);
  // Check-ins on dates that just got a record.
  await admin.rpc("refresh_synqiq_signed_in", { p_org: organizationId });
  return { upserted: rows.length, removed: gone.length };
}
