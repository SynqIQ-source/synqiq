import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dayBefore, findClashes, validateSeries, type BusyClass, type SeriesInput, type SeriesRow } from "@/lib/classes/schedule-editor";
import { generateSessions } from "@/lib/classes/calendar";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { buildClassCalendar, CALENDAR_DAYS } from "@/lib/sync/class-calendar";

// The schedule editor (Club Admins):
//   preview -- the first dates and any room / instructor clashes
//   create  -- add a class series (one row per time)
//   split   -- "this and following": end a SynqIQ series the day before and
//              start the changed one from that date
//   end     -- end a SynqIQ series on a date
// Mindbody's series change in Class Catalog until the schedule is taken over.
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Staff, rooms and layouts must be this studio's; returns their Mindbody ids
// (still used by the calendar and Mindbody comparisons) or an error.
async function resolve(admin: Admin, org: string, rows: SeriesRow[]) {
  const staffIds = [...new Set(rows.flatMap((row) => [row.staff_id, row.assistant_staff_id]).filter(Boolean))] as string[];
  const roomIds = [...new Set(rows.map((row) => row.room_id).filter(Boolean))] as string[];
  const layoutIds = [...new Set(rows.map((row) => row.layout_id).filter(Boolean))] as string[];
  const [{ data: staff }, { data: rooms }, { data: layouts }] = await Promise.all([
    staffIds.length
      ? admin.from("staff").select("id, mindbody_staff_id").eq("organization_id", org).in("id", staffIds)
      : Promise.resolve({ data: [] as { id: string; mindbody_staff_id: number | null }[] }),
    roomIds.length
      ? admin.from("rooms").select("id, mindbody_resource_id").eq("organization_id", org).in("id", roomIds)
      : Promise.resolve({ data: [] as { id: string; mindbody_resource_id: number | null }[] }),
    layoutIds.length
      ? admin.from("room_layouts").select("id, room_id").eq("organization_id", org).in("id", layoutIds)
      : Promise.resolve({ data: [] as { id: string; room_id: string }[] }),
  ]);
  const staffMindbody = new Map((staff ?? []).map((row) => [row.id as string, (row.mindbody_staff_id as number | null) ?? null]));
  const roomMindbody = new Map((rooms ?? []).map((row) => [row.id as string, (row.mindbody_resource_id as number | null) ?? null]));
  const layoutRoom = new Map((layouts ?? []).map((row) => [row.id as string, row.room_id as string]));
  for (const row of rows) {
    if (row.staff_id && !staffMindbody.has(row.staff_id)) return { error: "Pick one of the studio's instructors." };
    if (row.assistant_staff_id && !staffMindbody.has(row.assistant_staff_id)) return { error: "Pick one of the studio's instructors." };
    if (row.room_id && !roomMindbody.has(row.room_id)) return { error: "Pick one of the studio's rooms." };
    if (row.layout_id && layoutRoom.get(row.layout_id) !== row.room_id) return { error: "That layout belongs to a different room." };
  }
  return { staffMindbody, roomMindbody };
}

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as (SeriesInput & Record<string, unknown>) | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const { data: orgRow } = await admin.from("organizations").select("timezone").eq("id", org).maybeSingle();
  const timezone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const action = body.action;

  // Ending or splitting works on one SynqIQ series.
  let existing: Record<string, unknown> | null = null;
  if (action === "split" || action === "end") {
    const id = typeof body.scheduleId === "string" && UUID.test(body.scheduleId) ? body.scheduleId : null;
    const { data } = id
      ? await admin.from("class_schedules").select("*").eq("organization_id", org).eq("id", id).maybeSingle()
      : { data: null };
    if (!data) return fail("Class time not found.", 404);
    if (data.source !== "synqiq")
      return fail("This class time still comes from Mindbody. Change it in Class Catalog until the schedule is taken over.");
    existing = data;
  }

  if (action === "end") {
    const endDate = typeof body.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate) ? body.endDate : null;
    if (!endDate) return fail("Pick the last date.");
    if (endDate < today) return fail("The last date can't be in the past.");
    const edits = { ...((existing!.edits as Record<string, CatalogValue> | null) ?? {}) };
    delete edits.end_date;
    const { error } = await admin
      .from("class_schedules")
      .update({ end_date: endDate, edits })
      .eq("id", existing!.id as string);
    if (error) return fail("Couldn't save. Try again.", 500);
    await admin.from("catalog_edits").insert({
      organization_id: org,
      entity: "class_schedule",
      row_id: existing!.id,
      changes: { end_date: { from: existing!.end_date ?? null, to: endDate } },
      edited_by_staff_id: staff.id,
      note: "Series ended",
    });
    const rebuilt = await buildClassCalendar(org);
    if (!rebuilt.success) console.error("[class-schedules] calendar rebuild failed:", rebuilt.error);
    return NextResponse.json({ success: true });
  }

  // The class the series is for (a split keeps its class).
  const classTypeId = existing ? (existing.class_type_id as string | null) : typeof body.classTypeId === "string" ? body.classTypeId : null;
  if (!classTypeId || !UUID.test(classTypeId)) return fail("Pick a class.");
  const { data: type } = await admin
    .from("class_types")
    .select("id, name, edits")
    .eq("organization_id", org)
    .eq("id", classTypeId)
    .maybeSingle();
  if (!type) return fail("Pick one of the studio's classes.");
  const className = effective("class_type", type as { id: string; name: string; edits: Record<string, CatalogValue> | null })
    .name as string;

  const input: SeriesInput = action === "split" ? { ...body, kind: "recurring", startDate: body.fromDate } : body;
  const validated = validateSeries(input, today);
  if (!validated.ok) return fail(validated.error);
  const resolved = await resolve(admin, org, validated.rows);
  if ("error" in resolved) return fail(resolved.error as string);

  if (action === "preview") {
    const to = DateTime.fromISO(validated.rows[0].start_date).plus({ days: 56 }).toISODate()!;
    const planned = generateSessions(
      validated.rows.map((row, index) => ({
        id: `new-${index}`,
        classTypeId,
        className,
        days: row.days,
        startTime: row.start_time,
        endTime: row.end_time,
        startDate: row.start_date,
        endDate: row.end_date,
        frequencyInterval: row.frequency_interval,
        resourceId: null,
        capacity: row.capacity,
        staffMindbodyId: null,
        mindbodyClassScheduleId: null,
      })),
      validated.rows[0].start_date,
      to,
      timezone,
    );
    const rowOf = (id: string) => validated.rows[Number(id.slice(4))];
    // Clashes inside SynqIQ's calendar window (21 days ahead).
    const windowEnd = DateTime.now().setZone(timezone).plus({ days: CALENDAR_DAYS }).toISODate()!;
    const { data: busyRows } = await admin
      .from("class_sessions")
      .select(
        "class_schedule_id, class_name, local_date, start_time, end_time, mindbody_resource_id, staff_mindbody_id, staff_id, assistant_staff_id, edits",
      )
      .eq("organization_id", org)
      .gte("local_date", validated.rows[0].start_date)
      .lte("local_date", windowEnd)
      .is("removed_from_schedule_at", null)
      .limit(5000);
    const [{ data: roomRows }, { data: staffRows }] = await Promise.all([
      admin.from("rooms").select("id, mindbody_resource_id").eq("organization_id", org),
      admin.from("staff").select("id, mindbody_staff_id").eq("organization_id", org).not("mindbody_staff_id", "is", null),
    ]);
    const roomByMindbody = new Map((roomRows ?? []).map((row) => [Number(row.mindbody_resource_id), row.id as string]));
    const staffByMindbody = new Map((staffRows ?? []).map((row) => [Number(row.mindbody_staff_id), row.id as string]));
    const busy: BusyClass[] = (busyRows ?? [])
      .filter((row) => !(existing && row.class_schedule_id === existing.id && (row.local_date as string) >= (body.fromDate as string)))
      .map((row) => {
        const merged = effective("class_session", row as Record<string, unknown> & { edits: Record<string, CatalogValue> | null });
        const staffMindbodyId = (merged.staff_mindbody_id as number | null) ?? null;
        return {
          className: row.class_name as string,
          localDate: row.local_date as string,
          startTime: String(merged.start_time),
          endTime: String(merged.end_time),
          roomId: merged.mindbody_resource_id ? (roomByMindbody.get(Number(merged.mindbody_resource_id)) ?? null) : null,
          staffIds: [row.staff_id, row.assistant_staff_id, staffMindbodyId ? staffByMindbody.get(staffMindbodyId) : null].filter(
            (id): id is string => Boolean(id),
          ),
          active: merged.active !== false,
        };
      })
      .filter((row) => row.active);
    const clashes = findClashes(
      planned.map((session) => {
        const row = rowOf(session.class_schedule_id);
        return {
          localDate: session.local_date,
          startTime: session.start_time,
          endTime: session.end_time,
          roomId: row.room_id,
          staffIds: [row.staff_id, row.assistant_staff_id].filter((id): id is string => Boolean(id)),
        };
      }),
      busy,
    );
    return NextResponse.json({
      success: true,
      dates: planned.slice(0, 8).map((session) => ({ date: session.local_date, start: session.start_time, end: session.end_time })),
      total: planned.length,
      clashes: clashes.slice(0, 20),
    });
  }

  if (action !== "create" && action !== "split") return fail("Unknown action.");

  if (existing) {
    // End the old series the day before the change.
    const edits = { ...((existing.edits as Record<string, CatalogValue> | null) ?? {}) };
    delete edits.end_date;
    const { error } = await admin
      .from("class_schedules")
      .update({ end_date: dayBefore(body.fromDate as string), edits })
      .eq("id", existing.id as string);
    if (error) return fail("Couldn't save. Try again.", 500);
  }

  const inserts = validated.rows.map((row) => ({
    ...row,
    organization_id: org,
    source: "synqiq",
    class_type_id: classTypeId,
    class_name: className,
    staff_mindbody_id: row.staff_id ? resolved.staffMindbody.get(row.staff_id) : null,
    mindbody_resource_id: row.room_id ? resolved.roomMindbody.get(row.room_id) : null,
    web_capacity: row.online_capacity ?? row.capacity,
    created_by_staff_id: staff.id,
  }));
  const { data: created, error } = await admin.from("class_schedules").insert(inserts).select("id");
  if (error) {
    console.error("[class-schedules] insert failed:", error.message);
    return fail("Couldn't save. Try again.", 500);
  }
  await admin.from("catalog_edits").insert(
    (created ?? []).map((row, index) => ({
      organization_id: org,
      entity: "class_schedule",
      row_id: row.id,
      changes: Object.fromEntries(Object.entries(validated.rows[index]).map(([field, value]) => [field, { from: null, to: value }])),
      edited_by_staff_id: staff.id,
      note: existing ? `Changed from ${body.fromDate as string} (replaces ${existing.id as string})` : "Created in SynqIQ",
    })),
  );
  const rebuilt = await buildClassCalendar(org);
  if (!rebuilt.success) console.error("[class-schedules] calendar rebuild failed:", rebuilt.error);
  return NextResponse.json({ success: true, ids: (created ?? []).map((row) => row.id) });
}
