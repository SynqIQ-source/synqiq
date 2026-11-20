import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import Link from "next/link";
import { MilestoneFollowUp, type MilestoneFollowUpItem } from "./milestone-follow-up";
import { FollowUpTabs } from "@/components/crm/follow-up-tabs";
import { redirect } from "next/navigation";
import { getEnabledModules, requireModule } from "@/lib/modules";
import { homePath, isInstructorAccess, isTrainerAccess } from "@/lib/permissions";

const TITLE = "Follow Up";
const DESCRIPTION =
  "Send a note to members who just reached a class milestone with you. They see your name and the studio; your email address stays private.";

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

export default async function FollowUpPage() {
  // Class follow-ups are the group fitness module; a Trainer-only studio's
  // trainers land on their New members tab instead.
  const moduleStaff = await requireModule("group_fitness", "trainer");
  // Class check-ins are for instructors (and club admins); a trainer who
  // doesn't teach classes goes to their New members tab.
  if (!(await getEnabledModules(moduleStaff.organizationId)).has("group_fitness") || !isInstructorAccess(moduleStaff)) {
    redirect(isTrainerAccess(moduleStaff) ? "/dashboard/follow-up/new-members" : homePath(moduleStaff));
  }
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return (
      <DashboardShell title={TITLE} description={DESCRIPTION}>
        <StaffNotProvisioned />
      </DashboardShell>
    );
  }

  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  // Members who reached a class milestone in this instructor's class (their
  // 1st, 3rd, 10th, 25th, 50th, 100th, every 100 after), waiting for a note.
  // Queued nightly and right after class (lib/email/milestones.ts); sending
  // or skipping one takes it off the list, and unsent ones expire in 14 days.
  const { data: pendingData, error: pendingError } = await supabase
    .from("milestone_emails")
    .select("id, client_name, class_count, class_name, class_start, subject, body")
    .eq("staff_id", currentStaff.id)
    .eq("status", "pending")
    .order("class_start", { ascending: false })
    .limit(200);
  if (pendingError) {
    throw new Error(`Failed to load your follow-ups: ${pendingError.message}`);
  }
  const followUps: MilestoneFollowUpItem[] = (pendingData ?? []).map((row) => ({
    id: row.id as string,
    name: ((row.client_name as string | null) ?? "").trim() || "Member",
    count: row.class_count as number,
    className: ((row.class_name as string | null) ?? "").trim() || "class",
    when: row.class_start
      ? DateTime.fromISO(row.class_start as string, { zone: "utc" })
          .setZone(timezone)
          .toFormat("EEE, MMM d")
      : "",
    subject: row.subject as string,
    body: row.body as string,
  }));

  // With the CRM module, a second tab lists new members assigned to this
  // trainer; the badge counts the ones they haven't reached out to yet.
  // The New members tab is the Trainer module.
  const newMembersTab = isTrainerAccess(currentStaff) && (await getEnabledModules(currentStaff.organizationId)).has("trainer");
  let awaitingOutreach = 0;
  if (newMembersTab) {
    const { data: assigned } = await supabase
      .from("crm_contacts")
      .select("id, trainer_assigned_at")
      .eq("trainer_staff_id", currentStaff.id)
      // Declined the intro: nothing left to reach out about.
      .is("intro_declined_at", null)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .limit(500);
    if (assigned && assigned.length > 0) {
      const { data: sent } = await supabase
        .from("crm_messages")
        .select("contact_id, created_at")
        .eq("direction", "outbound")
        .eq("sent_by_staff_id", currentStaff.id)
        .in(
          "contact_id",
          assigned.map((row) => row.id),
        );
      awaitingOutreach = assigned.filter(
        (row) =>
          !(sent ?? []).some(
            (message) => message.contact_id === row.id && (!row.trainer_assigned_at || message.created_at >= row.trainer_assigned_at),
          ),
      ).length;
    }
  }

  return (
    <DashboardShell title={TITLE} description={DESCRIPTION}>
      {newMembersTab ? <FollowUpTabs active="classes" newMembersBadge={awaitingOutreach} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Members who just reached a class milestone in your class. Your milestone note is filled in: edit it if you like, then send.{" "}
          <Link href="/dashboard/email/milestones" className="underline">
            Edit your milestone notes
          </Link>
        </p>
      </div>

      <div className="mt-6">
        {followUps.length === 0 ? (
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-base font-semibold text-foreground">You&apos;re all caught up</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              When a member reaches their 1st, 3rd, 10th, 25th, 50th or 100th class (or every 100 after) in one of your classes, they show
              up here with your note ready to send.
            </p>
          </section>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {followUps.map((item) => (
              <MilestoneFollowUp key={item.id} item={item} staffId={currentStaff.id} />
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
