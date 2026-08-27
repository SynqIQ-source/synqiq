import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients, type EmailRecipient } from "@/lib/email/send";
import { substitutionRequestReminderEmail } from "@/lib/email/templates";
import { getOptionalEnv } from "@/lib/env";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

const REMINDER_INTERVAL_DAYS = 4;

type OpenRequestRow = {
  id: string;
  requested_by: string;
  created_at: string;
  last_reminder_sent_at: string | null;
  occurrence: {
    id: string;
    organization_id: string;
    department_id: string | null;
    class_name: string | null;
    staff_id: string | null;
    start_datetime: string | null;
  } | null;
};

async function getOpenRequestsDueForReminder(supabase: SupabaseAdminClient): Promise<OpenRequestRow[]> {
  const { data, error } = await supabase
    .from("substitution_requests")
    .select(
      "id, requested_by, created_at, last_reminder_sent_at, occurrence:class_occurrences!substitution_requests_occurrence_id_fkey ( id, organization_id, department_id, class_name, staff_id, start_datetime )",
    )
    .eq("status", "open")
    .returns<OpenRequestRow[]>();

  if (error) {
    throw new Error(`Failed to load open substitution requests: ${error.message}`);
  }

  const now = DateTime.utc();

  return (data ?? []).filter((request) => {
    const occurrence = request.occurrence;
    if (!occurrence?.start_datetime) {
      return false;
    }

    // A class that already happened has nothing left to remind anyone
    // about -- status just hasn't been moved off 'open' for it (nothing in
    // this app auto-expires a stale request), don't nag about the past.
    if (DateTime.fromISO(occurrence.start_datetime, { zone: "utc" }) <= now) {
      return false;
    }

    // "Every 4 days" measured from whichever is more recent -- the
    // request's creation (immediate day-1 email already covered that one,
    // this column stays null until the first reminder) or the last
    // reminder actually sent. Checked daily (this runs inside
    // /api/sync/all), so a request becomes due the first daily check on or
    // after the 4-day mark, not on a literal fixed 4-day cron interval.
    const lastNotified = request.last_reminder_sent_at ?? request.created_at;
    const daysSince = now.diff(DateTime.fromISO(lastNotified, { zone: "utc" }), "days").days;
    return daysSince >= REMINDER_INTERVAL_DAYS;
  });
}

async function getRecipientsForRequest(
  supabase: SupabaseAdminClient,
  request: OpenRequestRow,
): Promise<EmailRecipient[]> {
  const occurrence = request.occurrence;
  if (!occurrence?.department_id || !occurrence.class_name) {
    return [];
  }

  // Same eligibility query as request creation (app/api/substitution-requests/route.ts),
  // but the reminder recipient set additionally includes the original
  // requester -- they need to know coverage still hasn't been found too,
  // not just the pool of people who could pick it up.
  let eligibilityQuery = supabase
    .from("instructor_class_eligibility")
    .select("staff:staff!instructor_class_eligibility_staff_id_fkey ( id, email )")
    .eq("department_id", occurrence.department_id)
    .eq("class_name", occurrence.class_name.trim())
    .eq("enabled", true);

  if (occurrence.staff_id) {
    eligibilityQuery = eligibilityQuery.neq("staff_id", occurrence.staff_id);
  }

  const { data: eligibilityRows, error: eligibilityError } = await eligibilityQuery;

  if (eligibilityError) {
    throw new Error(eligibilityError.message);
  }

  const eligibleEmails = (eligibilityRows ?? [])
    .map((row) => (row.staff as unknown as { id: string; email: string | null } | null))
    .filter((staff): staff is { id: string; email: string } => Boolean(staff?.email))
    .map((staff) => ({ email: staff.email }));

  const { data: requester } = await supabase
    .from("staff")
    .select("email")
    .eq("id", request.requested_by)
    .maybeSingle();

  const recipients = [...eligibleEmails];
  if (requester?.email) {
    recipients.push({ email: requester.email });
  }

  return recipients;
}

export type SendRemindersResult =
  | { success: true; requestsDue: number; remindersSent: number }
  | { success: false; error: string };

// Called once per day from app/api/sync/all/route.ts -- there's no Vercel
// Hobby cron budget left for a dedicated job (both slots already spent on
// the sync cron's DST-safe double firing), so "every 4 days" is
// implemented as a daily check against elapsed time rather than a literal
// 4-day cron interval. See getOpenRequestsDueForReminder for the exact
// due-date logic.
export async function sendSubstitutionReminders(): Promise<SendRemindersResult> {
  try {
    return await runReminderCheck();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function runReminderCheck(): Promise<SendRemindersResult> {
  const supabase = createSupabaseAdminClient();
  const dueRequests = await getOpenRequestsDueForReminder(supabase);

  const siteUrl = getOptionalEnv("NEXT_PUBLIC_SITE_URL");
  if (!siteUrl) {
    console.error("[substitution-reminders] NEXT_PUBLIC_SITE_URL is not set -- skipping, can't build a link.");
    return { success: true, requestsDue: dueRequests.length, remindersSent: 0 };
  }

  let remindersSent = 0;

  for (const request of dueRequests) {
    const occurrence = request.occurrence;
    if (!occurrence?.class_name || !occurrence.start_datetime) {
      continue;
    }

    try {
      const recipients = await getRecipientsForRequest(supabase, request);
      if (recipients.length === 0) {
        continue;
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("timezone")
        .eq("id", occurrence.organization_id)
        .maybeSingle();

      const { subject, html } = substitutionRequestReminderEmail({
        className: occurrence.class_name,
        startDatetime: occurrence.start_datetime,
        timezone: org?.timezone ?? "utc",
        siteUrl,
      });

      await sendEmailToRecipients(recipients, { subject, html });

      const { error: updateError } = await supabase
        .from("substitution_requests")
        .update({ last_reminder_sent_at: DateTime.utc().toISO() })
        .eq("id", request.id);

      if (updateError) {
        console.error(`[substitution-reminders] Failed to update last_reminder_sent_at for ${request.id}:`, updateError.message);
      } else {
        remindersSent++;
      }
    } catch (requestError) {
      // One request's failure (a bad eligibility row, a transient email
      // error) shouldn't stop the rest from being reminded -- same
      // per-item fault isolation as lib/sync/class-visits.ts.
      console.error(
        `[substitution-reminders] Failed to process reminder for request ${request.id}:`,
        requestError instanceof Error ? requestError.message : requestError,
      );
    }
  }

  return { success: true, requestsDue: dueRequests.length, remindersSent };
}
