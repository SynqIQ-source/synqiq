import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { pushStep, writebackActive, type MindbodyState } from "@/lib/booking/mindbody-state";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Dec 10 transition (Adam, 2026-11-19): SynqIQ bookings are copied into
// Mindbody so its class capacity stays right while members can still book in
// the Mindbody app. Approved Mindbody write. Runs only when the studio's
// switch is on and before its cut-off date; Mindbody never emails the member
// (SendEmail false). Every change is recorded on the booking.

const MAX_ATTEMPTS = 5;

// Mindbody's answers that mean the class is already the way SynqIQ wants it.
export function alreadyDone(action: "add" | "remove", message: string): boolean {
  return action === "remove"
    ? /no class visit found/i.test(message)
    : /already (booked|enrolled|signed up|on the waitlist|in this class)/i.test(message);
}

export async function pushPendingBookings(organizationId: string, options: { test?: boolean; limit?: number } = {}) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("timezone, mindbody_site_id, mindbody_booking_writeback, mindbody_writeback_until")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return { skipped: "studio not found" };
  const zone = (org.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.now().setZone(zone).toISODate()!;
  if (
    !options.test &&
    !writebackActive(Boolean(org.mindbody_booking_writeback), (org.mindbody_writeback_until as string | null) ?? null, today)
  )
    return { skipped: "write-back is off" };

  const { data: pending } = await admin
    .from("class_bookings")
    .select("id, class_session_id, mindbody_client_id, status, mindbody_synced_state, mindbody_sync_attempts")
    .eq("organization_id", organizationId)
    .eq("mindbody_sync_status", "pending")
    .lt("mindbody_sync_attempts", MAX_ATTEMPTS)
    .order("updated_at")
    .limit(options.limit ?? 100);
  if (!pending?.length) return { pushed: 0, failed: 0, skipped: 0 };

  const sessionIds = [...new Set(pending.map((row) => row.class_session_id as string))];
  const { data: sessions } = await admin.from("class_sessions").select("id, mindbody_class_schedule_id, starts_at").in("id", sessionIds);
  const sessionBy = new Map((sessions ?? []).map((row) => [row.id as string, row]));
  const mindbody = createMindbodyClient(org.mindbody_site_id ? { siteId: String(org.mindbody_site_id) } : undefined);
  let token: string | null = null;
  const counts = { pushed: 0, failed: 0, skipped: 0 };

  // A test run (Mindbody's Test mode: checked, not saved) records nothing.
  const record = async (id: string, values: Record<string, unknown>) => {
    if (options.test) return;
    await admin
      .from("class_bookings")
      .update({ ...values, mindbody_synced_at: new Date().toISOString() })
      .eq("id", id);
  };

  for (const booking of pending) {
    const id = booking.id as string;
    const session = sessionBy.get(booking.class_session_id as string);
    const clientId = booking.mindbody_client_id as string | null;
    if (!session || Date.parse(session.starts_at as string) < Date.now() - 3_600_000) {
      await record(id, { mindbody_sync_status: "skipped", mindbody_sync_error: "The class has already happened." });
      counts.skipped += 1;
      continue;
    }
    if (!clientId || !/^\d+$/.test(clientId)) {
      await record(id, { mindbody_sync_status: "skipped", mindbody_sync_error: "Not a Mindbody client." });
      counts.skipped += 1;
      continue;
    }
    const step = pushStep((booking.mindbody_synced_state as MindbodyState | null) ?? null, booking.status as string);
    if (step.action === "none") {
      await record(id, { mindbody_sync_status: "synced", mindbody_sync_error: null });
      continue;
    }
    const { data: occurrence } = await admin
      .from("class_occurrences")
      .select("mindbody_occurrence_id")
      .eq("organization_id", organizationId)
      .eq("mindbody_class_schedule_id", session.mindbody_class_schedule_id)
      .eq("start_datetime", session.starts_at)
      .maybeSingle();
    const classId = occurrence?.mindbody_occurrence_id == null ? null : Number(occurrence.mindbody_occurrence_id);
    if (!classId) {
      await record(id, { mindbody_sync_status: "failed", mindbody_sync_error: "No matching class in Mindbody." });
      counts.failed += 1;
      continue;
    }
    try {
      token ??= await mindbody.requireAccessToken();
      if (step.action === "add") await mindbody.addClientToClass(clientId, classId, { waitlist: step.waitlist, test: options.test }, token);
      else await mindbody.removeClientFromClass(clientId, classId, { lateCancel: step.lateCancel, test: options.test }, token);
      await record(id, {
        mindbody_sync_status: "synced",
        mindbody_synced_state: step.action === "remove" ? "out" : step.waitlist ? "waitlist" : "in",
        mindbody_sync_error: null,
      });
      counts.pushed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Mindbody didn't accept it.";
      // Already the way SynqIQ wants it (removed: no visit to remove; added:
      // already in the class): nothing to do.
      if (alreadyDone(step.action, message)) {
        await record(id, {
          mindbody_sync_status: "synced",
          mindbody_synced_state: step.action === "remove" ? "out" : step.waitlist ? "waitlist" : "in",
          mindbody_sync_error: null,
        });
        counts.pushed += 1;
        continue;
      }
      const attempts = Number(booking.mindbody_sync_attempts ?? 0) + 1;
      await record(id, {
        mindbody_sync_status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        mindbody_sync_attempts: attempts,
        mindbody_sync_error: message,
      });
      counts.failed += 1;
    }
  }
  return counts;
}

// Studios with write-back on (for the cron).
export async function writebackStudios(admin: Admin) {
  const { data } = await admin.from("organizations").select("id").eq("mindbody_booking_writeback", true);
  return (data ?? []).map((row) => row.id as string);
}
