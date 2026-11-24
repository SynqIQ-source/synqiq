import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { MAX_REMOVED_PER_RUN } from "@/lib/sync/classes";
import { hideCancelledSessions } from "@/lib/classes/cancelled-sessions";

// Every 15 minutes in studio hours (Dec 10 transition): Mindbody's booked
// counts for the next 7 days, so SynqIQ's class capacity includes people who
// booked in the Mindbody app since the nightly sync. Read-only; only updates
// classes the nightly sync already knows, and only counts that changed.
// Also picks up cancellations: a class Mindbody cancelled (IsCanceled), or
// one deleted from the Mindbody schedule (no longer returned), is marked
// is_canceled within 15 minutes instead of waiting for the nightly sync.

type MindbodyClass = { Id?: number; TotalBooked?: number; TotalSignedIn?: number; MaxCapacity?: number; WebCapacity?: number; IsCanceled?: boolean };
type Known = { total_booked: number | null; total_signed_in: number | null; is_canceled: boolean | null };

export async function refreshClassCounts(organizationId: string, days = 7) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("mindbody_site_id, timezone").eq("id", organizationId).maybeSingle();
  if (!org?.mindbody_site_id) return { skipped: "no Mindbody site" };
  const zone = (org.timezone as string | null) ?? "America/Chicago";
  const start = DateTime.now().setZone(zone).startOf("day");
  const end = start.plus({ days });
  const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) });
  // Staff login required: without it Mindbody returns the classes with
  // TotalBooked/TotalSignedIn blank, and those were written as 0 over every
  // class from today on (2026-11-20; same trap as the nightly sync 10-28).
  const accessToken = await mindbody.requireAccessToken();

  const classes: MindbodyClass[] = [];
  let complete = false;
  for (let offset = 0; offset < 2000; offset += 200) {
    const page = await mindbody.getClasses(accessToken, {
      startDateTime: start.toISO({ includeOffset: false })!,
      endDateTime: end.toISO({ includeOffset: false })!,
      offset,
      limit: 200,
    });
    const rows = (page.Classes ?? []) as MindbodyClass[];
    classes.push(...rows);
    if (rows.length < 200) {
      complete = true;
      break;
    }
  }
  const ids = classes.map((row) => row.Id).filter((id): id is number => typeof id === "number");
  if (!ids.length) return { classes: 0, updated: 0 };

  const known = new Map<number, Known>();
  for (let index = 0; index < ids.length; index += 300) {
    const { data } = await admin
      .from("class_occurrences")
      .select("mindbody_occurrence_id, total_booked, total_signed_in, is_canceled")
      .eq("organization_id", organizationId)
      .in("mindbody_occurrence_id", ids.slice(index, index + 300));
    for (const row of data ?? [])
      known.set(Number(row.mindbody_occurrence_id), row as Known);
  }
  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;
  let cancelled = 0;
  for (const cls of classes) {
    const current = cls.Id == null ? undefined : known.get(cls.Id);
    if (!current) continue;
    const isCanceled = cls.IsCanceled === true;
    if (Boolean(current.is_canceled) !== isCanceled) {
      const { error } = await admin
        .from("class_occurrences")
        .update({ is_canceled: isCanceled })
        .eq("organization_id", organizationId)
        .eq("mindbody_occurrence_id", cls.Id!);
      if (!error && isCanceled) cancelled += 1;
    }
    // A blank count means Mindbody didn't tell us -- never write it as 0.
    if (typeof cls.TotalBooked !== "number" || typeof cls.TotalSignedIn !== "number") {
      skipped += 1;
      continue;
    }
    const booked = cls.TotalBooked;
    const signedIn = cls.TotalSignedIn;
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
  // Deleted from the Mindbody schedule: an upcoming class SynqIQ has that a
  // complete read of these days no longer returned.
  let removed = 0;
  if (complete) {
    const seen = new Set(ids);
    const { data: upcoming } = await admin
      .from("class_occurrences")
      .select("id, mindbody_occurrence_id")
      .eq("organization_id", organizationId)
      .eq("is_canceled", false)
      .is("class_session_id", null)
      .not("mindbody_occurrence_id", "is", null)
      .gte("start_datetime", now)
      .lt("start_datetime", end.toUTC().toISO()!);
    const missing = (upcoming ?? []).filter((row) => !seen.has(Number(row.mindbody_occurrence_id)));
    if (missing.length > MAX_REMOVED_PER_RUN) {
      console.error(`[classCounts] ${missing.length} upcoming classes missing from Mindbody; not marking any cancelled.`);
    } else if (missing.length) {
      const { error } = await admin
        .from("class_occurrences")
        .update({ is_canceled: true })
        .in("id", missing.map((row) => row.id as string));
      if (!error) removed = missing.length;
    }
  }
  if (cancelled || removed) await hideCancelledSessions(admin, organizationId);
  return { classes: classes.length, updated, skipped, cancelled, removed };
}
