import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withRetry } from "@/lib/retry";
import { siteIdOr } from "@/lib/sync/sites";
import {
  toClassTypeRow,
  toProgramUpdate,
  toScheduleRow,
  toSessionTypeRow,
  type MindbodyClassDescription,
  type MindbodyClassSchedule,
  type MindbodyProgram,
  type MindbodySessionType,
} from "@/lib/classes/catalog";

// The studio's class catalog from Mindbody (read-only GETs): programs with
// booking rules (departments), rooms, class types with descriptions, class
// schedules and session types. About 6 calls. SynqIQ edits (`edits`
// columns) are never touched. Each schedule's room and capacity come from
// its latest class in class_occurrences (Mindbody's schedule lacks them).

export type SyncClassCatalogResult =
  | { success: true; programs: number; rooms: number; classTypes: number; schedules: number; sessionTypes: number }
  | { success: false; error: string };

async function paged<T>(fetchPage: (offset: number) => Promise<Record<string, unknown>>, key: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 20; page += 1) {
    const response = await withRetry(() => fetchPage(rows.length));
    const list = (response[key] as T[] | undefined) ?? [];
    rows.push(...list);
    const total = (response.PaginationResponse as { TotalResults?: number } | undefined)?.TotalResults ?? 0;
    if (list.length === 0 || rows.length >= total) break;
  }
  return rows;
}

export async function syncClassCatalog(options: { siteId?: number } = {}): Promise<SyncClassCatalogResult> {
  try {
    const siteId = siteIdOr(options.siteId);
    const supabase = createSupabaseAdminClient();
    const { data: org, error: orgError } = await supabase.from("organizations").select("id").eq("mindbody_site_id", siteId).maybeSingle();
    if (orgError || !org) throw new Error(orgError?.message ?? `No studio for Mindbody site ${siteId}.`);
    const mindbody = createMindbodyClient({ siteId: String(siteId) });
    const accessToken = await mindbody.requireAccessToken();
    const syncedAt = new Date().toISOString();
    const save = async (table: string, rows: Record<string, unknown>[], onConflict: string) => {
      for (let index = 0; index < rows.length; index += 500) {
        const { error } = await supabase.from(table).upsert(rows.slice(index, index + 500), { onConflict });
        if (error) throw new Error(`Saving ${table} failed: ${error.message}`);
      }
    };

    const programs = ((await withRetry(() => mindbody.getPrograms(accessToken))) as { Programs?: MindbodyProgram[] }).Programs ?? [];
    await save(
      "departments",
      programs.map((program) => ({
        organization_id: org.id,
        mindbody_program_id: program.Id,
        active: true,
        synced_at: syncedAt,
        ...toProgramUpdate(program),
      })),
      "organization_id,mindbody_program_id",
    );

    const resources =
      ((await withRetry(() => mindbody.getResources(accessToken))) as { Resources?: { Id: number; Name?: string }[] }).Resources ?? [];
    await save(
      "rooms",
      resources.map((resource) => ({
        organization_id: org.id,
        mindbody_resource_id: resource.Id,
        name: resource.Name ?? `Room ${resource.Id}`,
        active: true,
        synced_at: syncedAt,
      })),
      "organization_id,mindbody_resource_id",
    );

    const descriptions = await paged<MindbodyClassDescription>(
      (offset) => mindbody.getClassDescriptions(accessToken, { offset, limit: 200 }) as Promise<Record<string, unknown>>,
      "ClassDescriptions",
    );
    await save(
      "class_types",
      [...new Map(descriptions.map((description) => [description.Id, description])).values()].map((description) => ({
        ...toClassTypeRow(org.id, description),
        synced_at: syncedAt,
      })),
      "organization_id,mindbody_class_description_id",
    );

    const schedules = await paged<MindbodyClassSchedule>(
      (offset) => mindbody.getClassSchedules(offset, accessToken) as Promise<Record<string, unknown>>,
      "ClassSchedules",
    );
    const { data: typeIdRows } = await supabase
      .from("class_types")
      .select("id, mindbody_class_description_id")
      .eq("organization_id", org.id);
    const typeIdByDescription = new Map((typeIdRows ?? []).map((row) => [row.mindbody_class_description_id as number, row.id as string]));
    // Room and capacity from each schedule's latest class.
    const { data: roomRows } = await supabase.from("rooms").select("id, mindbody_resource_id").eq("organization_id", org.id);
    const resourceByRoom = new Map((roomRows ?? []).map((room) => [room.id as string, room.mindbody_resource_id as number]));
    const latest = new Map<
      number,
      { room_id: string | null; max_capacity: number | null; web_capacity: number | null; start_datetime: string }
    >();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("class_occurrences")
        .select("mindbody_class_schedule_id, room_id, max_capacity, web_capacity, start_datetime")
        .eq("organization_id", org.id)
        .gte("start_datetime", new Date(Date.now() - 90 * 86_400_000).toISOString())
        .order("start_datetime", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const scheduleId = Number(row.mindbody_class_schedule_id);
        if (scheduleId && !latest.has(scheduleId)) latest.set(scheduleId, row as never);
      }
      if (!data || data.length < 1000) break;
    }
    await save(
      "class_schedules",
      [...new Map(schedules.map((schedule) => [schedule.Id, schedule])).values()].map((schedule) => {
        const last = latest.get(schedule.Id);
        return {
          ...toScheduleRow(org.id, schedule),
          class_type_id: schedule.ClassDescription?.Id ? (typeIdByDescription.get(schedule.ClassDescription.Id) ?? null) : null,
          mindbody_resource_id: last?.room_id ? (resourceByRoom.get(last.room_id) ?? null) : null,
          capacity: last?.max_capacity ?? null,
          web_capacity: last?.web_capacity ?? null,
          last_class_at: last?.start_datetime ?? null,
          synced_at: syncedAt,
        };
      }),
      "organization_id,mindbody_class_schedule_id",
    );

    // Classes on Mindbody's calendar whose schedule its schedule API doesn't
    // return (one-off classes): build a schedule from their dates so they
    // land on SynqIQ's calendar too.
    const importedIds = new Set(schedules.map((schedule) => schedule.Id));
    const { data: upcoming } = await supabase
      .from("class_occurrences")
      .select("mindbody_class_schedule_id, class_name, start_datetime, end_datetime, room_id, max_capacity, web_capacity, staff_id")
      .eq("organization_id", org.id)
      .gte("start_datetime", new Date().toISOString())
      .order("start_datetime");
    const orphans = new Map<number, NonNullable<typeof upcoming>>();
    for (const row of upcoming ?? []) {
      const scheduleId = Number(row.mindbody_class_schedule_id);
      if (!scheduleId || importedIds.has(scheduleId)) continue;
      orphans.set(scheduleId, [...(orphans.get(scheduleId) ?? []), row]);
    }
    if (orphans.size) {
      const { data: orgRow } = await supabase.from("organizations").select("timezone").eq("id", org.id).maybeSingle();
      const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
      const staffIds = [
        ...new Set(
          [...orphans.values()]
            .flat()
            .map((row) => row.staff_id)
            .filter(Boolean),
        ),
      ] as string[];
      const { data: staffRows } = staffIds.length
        ? await supabase.from("staff").select("id, mindbody_staff_id").in("id", staffIds)
        : { data: [] as { id: string; mindbody_staff_id: number | null }[] };
      const mindbodyStaff = new Map((staffRows ?? []).map((row) => [row.id as string, row.mindbody_staff_id as number | null]));
      const { data: typeRows } = await supabase.from("class_types").select("id, name").eq("organization_id", org.id);
      const typeByName = new Map((typeRows ?? []).map((row) => [(row.name as string).toLowerCase(), row.id as string]));
      const local = (iso: string) => DateTime.fromISO(iso).setZone(zone);
      await save(
        "class_schedules",
        [...orphans.entries()].map(([scheduleId, rows]) => {
          const first = rows[0];
          const dates = rows.map((row) => local(row.start_datetime as string));
          return {
            organization_id: org.id,
            mindbody_class_schedule_id: scheduleId,
            class_type_id: typeByName.get(String(first.class_name ?? "").toLowerCase()) ?? null,
            class_name: first.class_name,
            days: [...new Set(dates.map((date) => date.weekday % 7))].sort(),
            start_time: local(first.start_datetime as string).toFormat("HH:mm:ss"),
            end_time: local(first.end_datetime as string).toFormat("HH:mm:ss"),
            start_date: dates[0].toISODate(),
            end_date: dates[dates.length - 1].toISODate(),
            frequency_type: "OneOff",
            frequency_interval: 1,
            is_available: true,
            mindbody_resource_id: first.room_id ? (resourceByRoom.get(first.room_id as string) ?? null) : null,
            capacity: first.max_capacity ?? null,
            web_capacity: first.web_capacity ?? null,
            staff_mindbody_id: first.staff_id ? (mindbodyStaff.get(first.staff_id as string) ?? null) : null,
            last_class_at: first.start_datetime,
            synced_at: syncedAt,
          };
        }),
        "organization_id,mindbody_class_schedule_id",
      );
    }

    const sessionTypes =
      ((await withRetry(() => mindbody.getSessionTypes(accessToken))) as { SessionTypes?: MindbodySessionType[] }).SessionTypes ?? [];
    await save(
      "session_types",
      sessionTypes.map((sessionType) => ({ ...toSessionTypeRow(org.id, sessionType), synced_at: syncedAt })),
      "organization_id,mindbody_session_type_id",
    );

    return {
      success: true,
      programs: programs.length,
      rooms: resources.length,
      classTypes: descriptions.length,
      schedules: schedules.length,
      sessionTypes: sessionTypes.length,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
