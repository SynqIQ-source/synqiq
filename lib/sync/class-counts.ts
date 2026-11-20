import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";

// Every 15 minutes in studio hours (Dec 10 transition): Mindbody's booked
// counts for the next 7 days, so SynqIQ's class capacity includes people who
// booked in the Mindbody app since the nightly sync. Read-only; only updates
// classes the nightly sync already knows, and only counts that changed.

type MindbodyClass = { Id?: number; TotalBooked?: number; TotalSignedIn?: number; MaxCapacity?: number; WebCapacity?: number };

export async function refreshClassCounts(organizationId: string, days = 7) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("mindbody_site_id, timezone").eq("id", organizationId).maybeSingle();
  if (!org?.mindbody_site_id) return { skipped: "no Mindbody site" };
  const zone = (org.timezone as string | null) ?? "America/Chicago";
  const start = DateTime.now().setZone(zone).startOf("day");
  const end = start.plus({ days });
  const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) });

  const classes: MindbodyClass[] = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const page = await mindbody.getClasses(undefined, {
      startDateTime: start.toISO({ includeOffset: false })!,
      endDateTime: end.toISO({ includeOffset: false })!,
      offset,
      limit: 200,
    });
    const rows = (page.Classes ?? []) as MindbodyClass[];
    classes.push(...rows);
    if (rows.length < 200) break;
  }
  const ids = classes.map((row) => row.Id).filter((id): id is number => typeof id === "number");
  if (!ids.length) return { classes: 0, updated: 0 };

  const known = new Map<number, { total_booked: number | null; total_signed_in: number | null }>();
  for (let index = 0; index < ids.length; index += 300) {
    const { data } = await admin
      .from("class_occurrences")
      .select("mindbody_occurrence_id, total_booked, total_signed_in")
      .eq("organization_id", organizationId)
      .in("mindbody_occurrence_id", ids.slice(index, index + 300));
    for (const row of data ?? [])
      known.set(Number(row.mindbody_occurrence_id), row as { total_booked: number | null; total_signed_in: number | null });
  }
  const now = new Date().toISOString();
  let updated = 0;
  for (const cls of classes) {
    const current = cls.Id == null ? undefined : known.get(cls.Id);
    if (!current) continue;
    const booked = cls.TotalBooked ?? 0;
    const signedIn = cls.TotalSignedIn ?? 0;
    // counts_read_at moves either way: it marks when these counts were read
    // (SynqIQ bookings pushed before it are already in TotalBooked). Not
    // sync_timestamp: the nightly class sync uses that to know it ran today.
    const { error } = await admin
      .from("class_occurrences")
      .update(
        current.total_booked === booked && current.total_signed_in === signedIn
          ? { counts_read_at: now }
          : { total_booked: booked, total_signed_in: signedIn, counts_read_at: now },
      )
      .eq("organization_id", organizationId)
      .eq("mindbody_occurrence_id", cls.Id!);
    if (!error && (current.total_booked !== booked || current.total_signed_in !== signedIn)) updated += 1;
  }
  return { classes: classes.length, updated };
}
