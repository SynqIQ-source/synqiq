import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { CALENDAR_DAYS } from "@/lib/sync/class-calendar";

// The public class schedule for a studio's website widget. Read with the
// service role but returns ONLY public fields (class, time, instructor,
// room, spots left, description) -- never members or bookings by person.

export type PublicClass = {
  id: string;
  date: string; // YYYY-MM-DD, studio time
  start: string; // "6:05 AM"
  end: string;
  startsAt: string; // ISO
  name: string;
  typeId: string | null;
  program: string | null;
  instructor: string | null;
  room: string | null;
  capacity: number | null;
  spotsLeft: number | null;
  cancelled: boolean;
  isPool: boolean;
};

export type PublicClassType = {
  id: string;
  name: string;
  description: string | null;
  level: string | null;
  category: string | null;
  program: string | null;
  lateCancelMinutes: number | null;
};

export type PublicSchedule = {
  studio: { name: string; logoUrl: string | null; primaryColor: string; timezone: string };
  days: string[];
  classes: PublicClass[];
  types: Record<string, PublicClassType>;
};

type Edits = Record<string, CatalogValue> | null;

export async function loadPublicSchedule(mindbodySiteId: number): Promise<PublicSchedule | null> {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, timezone, logo_url, primary_color")
    .eq("mindbody_site_id", mindbodySiteId)
    .maybeSingle();
  if (!org) return null;
  const orgId = org.id as string;
  const timezone = (org.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone);
  const from = today.toISODate()!;
  const to = today.plus({ days: CALENDAR_DAYS }).toISODate()!;

  const [{ data: sessions }, { data: typeRows }, { data: programRows }, { data: rooms }, { data: teachers }, { data: occurrences }] =
    await Promise.all([
      admin
        .from("class_sessions")
        .select(
          "id, class_type_id, class_name, local_date, start_time, end_time, starts_at, capacity, staff_mindbody_id, mindbody_resource_id, mindbody_class_schedule_id, removed_from_schedule_at, edits",
        )
        .eq("organization_id", orgId)
        .gte("local_date", from)
        .lte("local_date", to)
        .order("starts_at")
        .limit(5000),
      admin
        .from("class_types")
        .select("id, name, description_text, level, category, mindbody_program_id, active, edits")
        .eq("organization_id", orgId),
      admin.from("departments").select("mindbody_program_id, name, cancel_window_minutes, edits").eq("organization_id", orgId),
      admin.from("rooms").select("mindbody_resource_id, name, edits").eq("organization_id", orgId),
      admin.from("staff").select("mindbody_staff_id, display_name").eq("organization_id", orgId).not("mindbody_staff_id", "is", null),
      admin
        .from("class_occurrences")
        .select("mindbody_class_schedule_id, start_datetime, total_booked")
        .eq("organization_id", orgId)
        .gte("start_datetime", today.startOf("day").toUTC().toISO()!)
        .lte("start_datetime", today.plus({ days: CALENDAR_DAYS }).endOf("day").toUTC().toISO()!)
        .limit(5000),
    ]);

  const sessionIds = (sessions ?? []).map((row) => row.id as string);
  const synqiqBooked = new Map<string, number>();
  for (let index = 0; index < sessionIds.length; index += 300) {
    const { data } = await admin
      .from("class_bookings")
      .select("class_session_id")
      .in("class_session_id", sessionIds.slice(index, index + 300))
      .in("status", ["booked", "checked_in"]);
    for (const row of data ?? [])
      synqiqBooked.set(row.class_session_id as string, (synqiqBooked.get(row.class_session_id as string) ?? 0) + 1);
  }

  const programs = new Map(
    (programRows ?? []).map((row) => {
      const merged = effective("program", row as Record<string, unknown> & { edits: Edits });
      return [
        Number(row.mindbody_program_id),
        { name: row.name as string, lateCancel: (merged.cancel_window_minutes as number | null) ?? null },
      ];
    }),
  );
  const types: Record<string, PublicClassType> = {};
  for (const row of typeRows ?? []) {
    const merged = effective("class_type", row as Record<string, unknown> & { edits: Edits });
    const program = row.mindbody_program_id ? programs.get(Number(row.mindbody_program_id)) : undefined;
    types[row.id as string] = {
      id: row.id as string,
      name: merged.name as string,
      description: (merged.description_text as string | null) ?? null,
      level: (merged.level as string | null) ?? null,
      category: (merged.category as string | null) ?? null,
      program: program?.name ?? null,
      lateCancelMinutes: program?.lateCancel ?? null,
    };
  }
  const roomName = new Map(
    (rooms ?? []).map((row) => [
      Number(row.mindbody_resource_id),
      effective("room", row as Record<string, unknown> & { edits: Edits }).name as string,
    ]),
  );
  const teacherName = new Map((teachers ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));
  const mindbodyBooked = new Map(
    (occurrences ?? []).map((row) => [
      `${row.mindbody_class_schedule_id}|${Date.parse(row.start_datetime as string)}`,
      Number(row.total_booked ?? 0),
    ]),
  );
  const clock = (time: string) => DateTime.fromFormat(time.slice(0, 5), "HH:mm").toFormat("h:mm a");

  const classes: PublicClass[] = [];
  for (const row of sessions ?? []) {
    if (row.removed_from_schedule_at) continue;
    const merged = effective("class_session", row as Record<string, unknown> & { edits: Edits });
    const type = row.class_type_id ? types[row.class_type_id as string] : undefined;
    const capacity = (merged.capacity as number | null) ?? null;
    const taken =
      (mindbodyBooked.get(`${row.mindbody_class_schedule_id}|${Date.parse(row.starts_at as string)}`) ?? 0) +
      (synqiqBooked.get(row.id as string) ?? 0);
    const staffId = (merged.staff_mindbody_id as number | null) ?? null;
    const roomId = (merged.mindbody_resource_id as number | null) ?? null;
    classes.push({
      id: row.id as string,
      date: row.local_date as string,
      start: clock(String(merged.start_time)),
      end: clock(String(merged.end_time)),
      startsAt: row.starts_at as string,
      name: type?.name ?? (row.class_name as string),
      typeId: (row.class_type_id as string | null) ?? null,
      program: type?.program ?? null,
      instructor: staffId ? (teacherName.get(staffId) ?? null) : null,
      room: roomId ? (roomName.get(roomId) ?? null) : null,
      capacity,
      spotsLeft: capacity === null ? null : Math.max(0, capacity - taken),
      cancelled: merged.active === false,
      isPool: /pool lane/i.test(row.class_name as string),
    });
  }
  classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.name.localeCompare(b.name));
  // Hide classes that already ended today.
  const now = Date.now();
  const upcoming = classes.filter((item) => Date.parse(item.startsAt) > now - 60 * 60_000);

  const days: string[] = [];
  for (let day = DateTime.fromISO(from); day.toISODate()! <= to; day = day.plus({ days: 1 })) days.push(day.toISODate()!);

  return {
    studio: {
      name: org.name as string,
      logoUrl: (org.logo_url as string | null) ?? null,
      primaryColor: (org.primary_color as string | null) ?? "#0f766e",
      timezone,
    },
    days,
    classes: upcoming,
    types,
  };
}
