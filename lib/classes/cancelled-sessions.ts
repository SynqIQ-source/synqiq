import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// A class cancelled in (or deleted from) Mindbody is hidden on SynqIQ's own
// class calendar too -- member app, website widget, booking and the Class
// Catalog -- by flagging the matching date removed_from_schedule_at, the
// same flag those pages already skip. Rebuilding the calendar clears the
// flag on every date it generates, so this runs after each rebuild as well
// as after each class sync; a class Mindbody reinstates comes back then.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const cancelKey = (scheduleId: unknown, startsAt: unknown) => `${Number(scheduleId)}|${Date.parse(String(startsAt))}`;

export async function hideCancelledSessions(admin: Admin, organizationId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cancelled, error } = await admin
    .from("class_occurrences")
    .select("mindbody_class_schedule_id, start_datetime")
    .eq("organization_id", organizationId)
    .eq("is_canceled", true)
    .is("class_session_id", null)
    .not("mindbody_class_schedule_id", "is", null)
    .gte("start_datetime", since)
    .limit(2000);
  if (error || !cancelled?.length) return 0;
  const keys = new Set(cancelled.map((row) => cancelKey(row.mindbody_class_schedule_id, row.start_datetime)));
  const scheduleIds = [...new Set(cancelled.map((row) => Number(row.mindbody_class_schedule_id)))];

  const { data: sessions } = await admin
    .from("class_sessions")
    .select("id, mindbody_class_schedule_id, starts_at")
    .eq("organization_id", organizationId)
    .is("removed_from_schedule_at", null)
    .in("mindbody_class_schedule_id", scheduleIds)
    .gte("starts_at", since)
    .limit(2000);
  const ids = (sessions ?? []).filter((row) => keys.has(cancelKey(row.mindbody_class_schedule_id, row.starts_at))).map((row) => row.id as string);
  if (!ids.length) return 0;
  const { error: updateError } = await admin
    .from("class_sessions")
    .update({ removed_from_schedule_at: new Date().toISOString() })
    .in("id", ids);
  if (updateError) {
    console.error("[hideCancelledSessions]", updateError.message);
    return 0;
  }
  return ids.length;
}
