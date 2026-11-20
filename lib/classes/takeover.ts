import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { buildClassCalendar } from "@/lib/sync/class-calendar";

// "Take over the schedule" (Dec 18): SynqIQ becomes the owner of the class
// schedule. Every running Mindbody series is adopted IN PLACE -- same row,
// same class, same room, so nothing is duplicated (one "Beat", one cycle
// studio) -- linked to SynqIQ staff and room ids, and Mindbody's forced end
// date (it makes every series end a year out) removed. Then the nightly
// Mindbody catalog import stops touching categories, rooms, classes and
// schedules for the studio. planTakeover is the dry run; runTakeover does it.

const RUNNING_DAYS = 30;
const FORCED_END_AFTER_DAYS = 90; // end dates further out than this are Mindbody's default, not a real end

type Edits = { edits: Record<string, CatalogValue> | null };
export type TakeoverPlan = {
  takenOverAt: string | null;
  series: number; // running Mindbody series to adopt
  classTypes: number;
  endDatesRemoved: number;
  endDatesKept: { className: string; endDate: string }[]; // near-term end dates (probably real) kept
  notRunning: number; // old Mindbody series left as history
  unmappedInstructors: { mindbodyStaffId: number; series: number }[];
  unmappedRooms: { mindbodyResourceId: number; series: number }[];
  sameNameClasses: string[]; // class names Mindbody already has twice (left as they are)
  sameNameRooms: string[];
  byCategory: { name: string; series: number }[];
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function load(admin: Admin, organizationId: string) {
  const [{ data: org }, { data: schedules }, { data: types }, { data: staff }, { data: rooms }, { data: programs }] = await Promise.all([
    admin.from("organizations").select("timezone, classes_taken_over_at").eq("id", organizationId).maybeSingle(),
    admin.from("class_schedules").select("*").eq("organization_id", organizationId).eq("source", "mindbody"),
    admin.from("class_types").select("id, name, source, active, mindbody_program_id, edits").eq("organization_id", organizationId),
    admin.from("staff").select("id, mindbody_staff_id").eq("organization_id", organizationId).not("mindbody_staff_id", "is", null),
    admin.from("rooms").select("id, name, mindbody_resource_id, active, edits").eq("organization_id", organizationId),
    admin.from("departments").select("name, mindbody_program_id").eq("organization_id", organizationId),
  ]);
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone);
  const since = today.minus({ days: RUNNING_DAYS }).toMillis();
  const forcedAfter = today.plus({ days: FORCED_END_AFTER_DAYS }).toISODate()!;
  const todayIso = today.toISODate()!;

  const running: { row: Record<string, unknown>; merged: Record<string, unknown> }[] = [];
  let notRunning = 0;
  for (const row of schedules ?? []) {
    const merged = effective("class_schedule", row as Record<string, unknown> & Edits);
    const ended = merged.end_date && (merged.end_date as string) < todayIso;
    const recent = row.last_class_at && Date.parse(row.last_class_at as string) >= since;
    const upcoming = row.start_date && (row.start_date as string) >= todayIso;
    if (merged.active === false || ended || !(recent || upcoming)) notRunning += 1;
    else running.push({ row, merged });
  }
  return {
    org,
    today: todayIso,
    forcedAfter,
    running,
    notRunning,
    types: types ?? [],
    staffByMindbody: new Map((staff ?? []).map((row) => [Number(row.mindbody_staff_id), row.id as string])),
    rooms: rooms ?? [],
    roomByMindbody: new Map((rooms ?? []).map((row) => [Number(row.mindbody_resource_id), row.id as string])),
    programName: new Map((programs ?? []).map((row) => [Number(row.mindbody_program_id), row.name as string])),
  };
}

export async function planTakeover(organizationId: string, admin: Admin = createSupabaseAdminClient()): Promise<TakeoverPlan> {
  const data = await load(admin, organizationId);
  const typeById = new Map(data.types.map((type) => [type.id as string, type]));
  const typeIds = new Set(data.running.map(({ row }) => row.class_type_id as string | null).filter(Boolean) as string[]);
  const count = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1);
  const missingStaff = new Map<number, number>();
  const missingRooms = new Map<number, number>();
  const byCategory = new Map<string, number>();
  let removed = 0;
  const kept: TakeoverPlan["endDatesKept"] = [];
  for (const { row, merged } of data.running) {
    const staff = merged.staff_mindbody_id as number | null;
    if (staff && !data.staffByMindbody.has(Number(staff))) count(missingStaff, Number(staff));
    const room = merged.mindbody_resource_id as number | null;
    if (room && !data.roomByMindbody.has(Number(room))) count(missingRooms, Number(room));
    const end = merged.end_date as string | null;
    if (end && end > data.forcedAfter) removed += 1;
    else if (end) kept.push({ className: String(row.class_name ?? "Class"), endDate: end });
    const type = row.class_type_id ? typeById.get(row.class_type_id as string) : undefined;
    const category = type?.mindbody_program_id != null ? (data.programName.get(Number(type.mindbody_program_id)) ?? "Other") : "Other";
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  const dupes = (names: string[]) => {
    const seen = new Map<string, number>();
    for (const name of names) seen.set(name.trim().toLowerCase(), (seen.get(name.trim().toLowerCase()) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  };
  const adoptedTypes = [...typeIds].map((id) => typeById.get(id)).filter(Boolean) as typeof data.types;
  return {
    takenOverAt: (data.org?.classes_taken_over_at as string | null) ?? null,
    series: data.running.length,
    classTypes: adoptedTypes.length,
    endDatesRemoved: removed,
    endDatesKept: kept.sort((a, b) => a.endDate.localeCompare(b.endDate)),
    notRunning: data.notRunning,
    unmappedInstructors: [...missingStaff.entries()].map(([mindbodyStaffId, series]) => ({ mindbodyStaffId, series })),
    unmappedRooms: [...missingRooms.entries()].map(([mindbodyResourceId, series]) => ({ mindbodyResourceId, series })),
    sameNameClasses: dupes(adoptedTypes.map((type) => String(effective("class_type", type as Record<string, unknown> & Edits).name))),
    sameNameRooms: dupes(
      data.rooms
        .filter((room) => room.active !== false)
        .map((room) => String(effective("room", room as Record<string, unknown> & Edits).name)),
    ),
    byCategory: [...byCategory.entries()].map(([name, series]) => ({ name, series })).sort((a, b) => b.series - a.series),
  };
}

export async function runTakeover(organizationId: string, staffId: string) {
  const admin = createSupabaseAdminClient();
  const data = await load(admin, organizationId);
  if (data.org?.classes_taken_over_at) return { success: false as const, error: "The schedule was already taken over." };
  let adopted = 0;
  let endDatesRemoved = 0;
  for (const { row, merged } of data.running) {
    const end = merged.end_date as string | null;
    const forced = Boolean(end && end > data.forcedAfter);
    const edits = { ...((row.edits as Record<string, CatalogValue> | null) ?? {}) };
    if (forced) delete edits.end_date;
    const staff = merged.staff_mindbody_id as number | null;
    const room = merged.mindbody_resource_id as number | null;
    const { error } = await admin
      .from("class_schedules")
      .update({
        source: "synqiq",
        staff_id: staff ? (data.staffByMindbody.get(Number(staff)) ?? null) : null,
        room_id: room ? (data.roomByMindbody.get(Number(room)) ?? null) : null,
        online_capacity: (row.web_capacity as number | null) ?? null,
        ...(forced ? { end_date: null } : {}),
        edits,
      })
      .eq("id", row.id as string)
      .eq("source", "mindbody");
    if (error) return { success: false as const, error: `Adopting a class time failed: ${error.message}`, adopted };
    adopted += 1;
    if (forced) endDatesRemoved += 1;
  }
  const typeIds = [...new Set(data.running.map(({ row }) => row.class_type_id as string | null).filter(Boolean))] as string[];
  for (let index = 0; index < typeIds.length; index += 200) {
    await admin
      .from("class_types")
      .update({ source: "synqiq" })
      .in("id", typeIds.slice(index, index + 200));
  }
  const takenOverAt = new Date().toISOString();
  await admin.from("organizations").update({ classes_taken_over_at: takenOverAt }).eq("id", organizationId);
  await admin.from("catalog_edits").insert({
    organization_id: organizationId,
    entity: "class_schedule",
    row_id: organizationId,
    changes: {
      takeover: { from: "mindbody", to: "synqiq" },
      series: { from: null, to: adopted },
      end_dates_removed: { from: null, to: endDatesRemoved },
    },
    edited_by_staff_id: staffId,
    note: "Schedule taken over from Mindbody",
  });
  const calendar = await buildClassCalendar(organizationId);
  return { success: true as const, adopted, classTypes: typeIds.length, endDatesRemoved, takenOverAt, calendar };
}
