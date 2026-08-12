import webpush, { WebPushError } from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Configured lazily inside sendPushToStaff, not at module load -- this file
// is imported (transitively) by /api/push/notify-board-message, and Next
// evaluates route modules during its build-time "Collecting page data" step.
// A top-level setVapidDetails() call ran then too, so a missing or
// malformed VAPID env var failed the entire production build rather than
// just this one route at request time. Guarded by a flag rather than
// re-validating on every call, since validation happens inside the
// web-push package itself and is cheap but not free.
let vapidConfigured = false;

function ensureVapidConfigured() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidConfigured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

// Always the admin client, never a caller's RLS-scoped one: push_subscriptions'
// RLS only lets a staff member see their own rows (by design -- see the
// migration), but sending a notification is inherently a cross-staff system
// operation (e.g. notifying every eligible instructor, not just the caller).
// Same precedent as getCurrentStaff()/getOrgBranding() using the admin
// client for legitimate cross-staff reads. Authorization for *who* gets
// notified is the caller's responsibility (e.g. instructor_class_eligibility
// already filtered the staffIds list before this is ever called) -- this
// helper trusts the staffIds it's given.
export async function sendPushToStaff(staffIds: string[], payload: PushPayload): Promise<void> {
  const uniqueStaffIds = [...new Set(staffIds)];
  if (uniqueStaffIds.length === 0) {
    return;
  }

  ensureVapidConfigured();
  const supabase = createSupabaseAdminClient();
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("staff_id", uniqueStaffIds);

  if (error) {
    console.error("[push] Failed to load subscriptions:", error.message);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    return;
  }

  const staleSubscriptionIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
        );
      } catch (sendError) {
        // 404/410 means the push service itself says this subscription is
        // gone (uninstalled, permission revoked, etc.) -- prune it so it
        // isn't retried forever. Any other error is logged, not retried
        // here (a transient push-service failure shouldn't spin up its own
        // retry infrastructure for what's already a best-effort notification).
        const statusCode = sendError instanceof WebPushError ? sendError.statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          staleSubscriptionIds.push(subscription.id);
        } else {
          console.error(
            "[push] Send failed:",
            sendError instanceof Error ? sendError.message : sendError,
          );
        }
      }
    }),
  );

  if (staleSubscriptionIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
  }
}
