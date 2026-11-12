import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";

// Copies trainers' appointment availability from Mindbody (read only:
// GET /appointment/scheduleitems) into trainer_availability for the next few
// weeks. Mindbody's rows in the window are replaced; hours added in SynqIQ
// are left alone. Mindbody returns naive studio-local times.

type MindbodyAvailability = {
  Id: number;
  Staff?: { Id?: number };
  StartDateTime: string;
  EndDateTime: string;
  SessionTypes?: { Id?: number }[] | null;
};

export async function syncTrainerAvailability(organizationId: string, weeks = 6) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone, mindbody_site_id").eq("id", organizationId).maybeSingle();
  if (!org?.mindbody_site_id) return { skipped: "no Mindbody site" };
  const zone = (org.timezone as string | null) ?? "America/Chicago";
  const start = DateTime.now().setZone(zone).startOf("day");
  const end = start.plus({ weeks });

  // Mindbody only returns availability when StaffIds is given: everyone who
  // is a trainer or has had an appointment lately.
  const [{ data: staffRows }, { data: recent }] = await Promise.all([
    admin.from("staff").select("id, mindbody_staff_id, is_trainer").eq("organization_id", organizationId),
    admin
      .from("appointment_occurrences")
      .select("staff_id")
      .eq("organization_id", organizationId)
      .gte("start_datetime", start.minus({ days: 90 }).toUTC().toISO()!)
      .limit(5000),
  ]);
  const recentIds = new Set((recent ?? []).map((row) => row.staff_id as string));
  const staffIds = (staffRows ?? [])
    .filter(
      (row) => row.mindbody_staff_id != null && Number(row.mindbody_staff_id) > 0 && (row.is_trainer || recentIds.has(row.id as string)),
    )
    .map((row) => Number(row.mindbody_staff_id));
  if (staffIds.length === 0) return { blocks: 0 };
  const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) });
  const token = await mindbody.requireAccessToken();
  const blocks: MindbodyAvailability[] = [];
  // One week per request keeps each response small.
  for (let day = start; day < end; day = day.plus({ weeks: 1 })) {
    for (let offset = 0; offset < 2000; offset += 200) {
      const response = (await mindbody.getScheduleItems(token, {
        staffIds,
        startDate: day.toISODate()!,
        endDate: day.plus({ days: 6 }).toISODate()!,
        offset,
        limit: 200,
      })) as {
        StaffMembers?: { Id?: number; Availabilities?: MindbodyAvailability[] | null }[];
        PaginationResponse?: { TotalResults?: number };
      };
      for (const staff of response.StaffMembers ?? []) {
        for (const block of staff.Availabilities ?? []) blocks.push({ ...block, Staff: { Id: block.Staff?.Id ?? staff.Id } });
      }
      const total = Number(response.PaginationResponse?.TotalResults ?? 0);
      if (offset + 200 >= total) break;
    }
  }

  const staffBy = new Map(
    (staffRows ?? []).filter((row) => row.mindbody_staff_id != null).map((row) => [Number(row.mindbody_staff_id), row.id as string]),
  );
  const seen = new Set<string>();
  const rows = blocks.flatMap((block) => {
    const staffId = staffBy.get(Number(block.Staff?.Id));
    if (!staffId) return [];
    const startsAt = DateTime.fromISO(block.StartDateTime, { zone }).toUTC().toISO()!;
    const endsAt = DateTime.fromISO(block.EndDateTime, { zone }).toUTC().toISO()!;
    const key = `${block.Id}|${startsAt}`;
    if (seen.has(key) || endsAt <= startsAt) return [];
    seen.add(key);
    const types = (block.SessionTypes ?? []).map((type) => Number(type.Id)).filter((id) => Number.isInteger(id));
    return [
      {
        organization_id: organizationId,
        staff_id: staffId,
        source: "mindbody",
        mindbody_availability_id: Number(block.Id),
        starts_at: startsAt,
        ends_at: endsAt,
        session_type_ids: types.length ? types : null,
      },
    ];
  });

  const fromIso = start.toUTC().toISO()!;
  const toIso = end.toUTC().toISO()!;
  const { error: deleteError } = await admin
    .from("trainer_availability")
    .delete()
    .eq("organization_id", organizationId)
    .eq("source", "mindbody")
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso);
  if (deleteError) throw new Error(deleteError.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("trainer_availability").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  await admin.from("organizations").update({ trainer_availability_synced_at: new Date().toISOString() }).eq("id", organizationId);
  return { blocks: rows.length };
}
