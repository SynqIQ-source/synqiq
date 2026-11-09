import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAndStoreOccurrenceVisits } from "@/lib/sync/class-visits";
import { isExcludedDepartmentName } from "@/lib/excluded-departments";
import { sendPushToStaff } from "@/lib/push/send";
import { sendEmailToRecipients } from "@/lib/email/send";
import { postClassFollowUpEmail } from "@/lib/email/templates";
import { getOptionalEnv } from "@/lib/env";

// Local hours (in each studio's own time zone) when reminders go out:
// noon covers the morning's classes, 8 PM the ones that ended since noon.
const SEND_HOURS_LOCAL = [12, 20];
// How far back a run looks for unreminded classes. 17h reaches from noon
// back past the previous 8 PM run, so a class ending after 8 PM (or one
// whose Mindbody fetch failed at 8 PM) is caught at noon the next day.
// The sent flag stops anything going out twice; the bound keeps a first
// deploy or a long outage from reminding about old classes.
const LOOKBACK_HOURS = 17;

type DueOccurrence = {
  id: string;
  organization_id: string;
  mindbody_occurrence_id: number;
  class_name: string | null;
  start_datetime: string;
  staff_id: string | null;
  substitute_staff_id: string | null;
  department: { name: string } | null;
};

export type PostClassReminderResult = {
  classesChecked: number;
  remindersSent: number;
  skippedNoCheckIns: number;
  failed: number;
};

// Cron fires hourly (vercel.json) but only does work for a studio when
// it's noon or 8 PM there, so every studio gets its reminders at those
// local times whatever its time zone (and through daylight-saving changes).
// For each group fitness class that ended since the last run: pull its
// attendance from Mindbody now (the nightly visits sync hasn't run yet, and
// Follow Up lists only synced check-ins), then remind the instructor who
// taught it -- by push and email -- to follow up with the members who
// came. Classes nobody checked in to are marked done without a reminder.
export async function runPostClassReminders(): Promise<PostClassReminderResult> {
  const supabase = createSupabaseAdminClient();
  const now = DateTime.utc();
  const result: PostClassReminderResult = { classesChecked: 0, remindersSent: 0, skippedNoCheckIns: 0, failed: 0 };

  const { data: moduleRows, error: moduleError } = await supabase
    .from("org_modules")
    .select("organization_id")
    .eq("module", "group_fitness")
    .eq("status", "enabled");
  if (moduleError) throw new Error(`Failed to load group fitness studios: ${moduleError.message}`);
  const groupFitnessOrgIds = [...new Set((moduleRows ?? []).map((row) => row.organization_id as string))];
  if (groupFitnessOrgIds.length === 0) return result;

  const { data: orgRows, error: orgError } = await supabase
    .from("organizations")
    .select("id, mindbody_site_id, timezone")
    .in("id", groupFitnessOrgIds);
  if (orgError) throw new Error(`Failed to load studios: ${orgError.message}`);

  const orgs = (orgRows ?? []).filter((org) =>
    SEND_HOURS_LOCAL.includes(now.setZone(org.timezone ?? "America/Chicago").hour),
  );
  if (orgs.length === 0) return result;

  const { data: dueRows, error: dueError } = await supabase
    .from("class_occurrences")
    .select(
      "id, organization_id, mindbody_occurrence_id, class_name, start_datetime, staff_id, substitute_staff_id, department:departments!class_occurrences_department_id_fkey ( name )",
    )
    .in(
      "organization_id",
      orgs.map((org) => org.id),
    )
    .is("followup_reminder_sent_at", null)
    .not("mindbody_occurrence_id", "is", null)
    .not("start_datetime", "is", null)
    .lte("end_datetime", now.toISO() ?? "")
    .gte("end_datetime", now.minus({ hours: LOOKBACK_HOURS }).toISO() ?? "")
    .returns<DueOccurrence[]>();
  if (dueError) throw new Error(`Failed to load recently ended classes: ${dueError.message}`);

  // Pool Lanes etc. aren't classes anyone follows up on.
  const due = (dueRows ?? []).filter((row) => !isExcludedDepartmentName(row.department?.name));
  if (due.length === 0) return result;

  const siteUrl = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
  const syncedAt = now.toISO() ?? "";

  for (const org of orgs) {
    const orgClasses = due.filter((row) => row.organization_id === org.id);
    if (orgClasses.length === 0) continue;
    const mindbody = createMindbodyClient(
      org.mindbody_site_id ? { siteId: String(org.mindbody_site_id) } : undefined,
    );

    let accessToken: string;
    try {
      accessToken = await mindbody.requireAccessToken();
    } catch (loginError) {
      // Leave this studio's classes unclaimed; the next run (noon or 8 PM)
      // picks them up while they're inside the lookback.
      result.failed += orgClasses.length;
      console.error(`[post-class-reminders] Mindbody login failed for org ${org.id}:`, loginError);
      continue;
    }

    for (const occurrence of orgClasses) {
      result.classesChecked++;

      // Claim first so overlapping runs can't both remind.
      const { data: claimed } = await supabase
        .from("class_occurrences")
        .update({ followup_reminder_sent_at: now.toISO() })
        .eq("id", occurrence.id)
        .is("followup_reminder_sent_at", null)
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      let signedInCount: number;
      try {
        ({ signedInCount } = await fetchAndStoreOccurrenceVisits({
          mindbody,
          accessToken,
          supabase,
          organizationId: org.id,
          occurrence,
          syncedAt,
        }));
      } catch (visitsError) {
        // Release the claim so the next run tries again (while the class
        // is still inside the lookback).
        await supabase.from("class_occurrences").update({ followup_reminder_sent_at: null }).eq("id", occurrence.id);
        result.failed++;
        console.error(`[post-class-reminders] Mindbody visits failed for occurrence ${occurrence.id}:`, visitsError);
        continue;
      }

      if (signedInCount === 0) {
        result.skippedNoCheckIns++;
        continue;
      }

      // Whoever actually taught it: the approved sub, else the scheduled instructor.
      const instructorId = occurrence.substitute_staff_id ?? occurrence.staff_id;
      if (!instructorId) continue;

      const { data: instructor } = await supabase
        .from("staff")
        .select("id, display_name, email, archived_at")
        .eq("id", instructorId)
        .maybeSingle();
      if (!instructor || instructor.archived_at) continue;

      const className = occurrence.class_name?.trim() || "your class";
      const people = signedInCount === 1 ? "1 member" : `${signedInCount} members`;

      try {
        await sendPushToStaff([instructor.id], {
          title: "Follow up with your class",
          body: `${people} checked in to ${className}. Send them a quick note.`,
          url: "/dashboard/follow-up",
        });
      } catch (pushError) {
        console.error(`[post-class-reminders] Push failed for occurrence ${occurrence.id}:`, pushError);
      }

      if (instructor.email) {
        await sendEmailToRecipients(
          [{ email: instructor.email, displayName: instructor.display_name }],
          postClassFollowUpEmail({
            className,
            startDatetime: occurrence.start_datetime,
            timezone: org.timezone ?? "utc",
            siteUrl,
            checkedInCount: signedInCount,
          }),
        );
      }

      result.remindersSent++;
    }
  }

  return result;
}
