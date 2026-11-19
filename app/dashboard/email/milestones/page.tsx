import type { Metadata } from "next";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin, isInstructorAccess } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MILESTONES, SUGGESTED } from "@/lib/email/milestone-content";
import { MilestonesEditor, type PendingEmail, type TemplateRow } from "./milestones-editor";

export const metadata: Metadata = { title: "Milestone emails" };
export const dynamic = "force-dynamic";

// Admin > Email > Milestones. Instructors: their own milestone emails and the
// ones waiting for their OK. Club Admins: pick any instructor.
export default async function MilestonesPage({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const staff = await requireAccess(isInstructorAccess);
  const isAdmin = isClubAdmin(staff);
  const admin = createSupabaseAdminClient();
  const { data: instructors } = isAdmin
    ? await admin
        .from("staff")
        .select("id, display_name")
        .eq("organization_id", staff.organizationId)
        .eq("is_instructor", true)
        .is("archived_at", null)
        .order("display_name")
    : { data: null };
  const requested = (await searchParams).staff;
  const ownerId = isAdmin && requested && (instructors ?? []).some((row) => row.id === requested) ? requested : staff.id;

  const [{ data: templates }, { data: emails }, { data: org }] = await Promise.all([
    admin
      .from("milestone_templates")
      .select("milestone, subject, body, enabled, disabled_by_admin")
      .eq("organization_id", staff.organizationId)
      .eq("staff_id", ownerId),
    admin
      .from("milestone_emails")
      .select("id, client_name, class_count, class_name, class_start, subject, body, status, decided_at, sent_to")
      .eq("organization_id", staff.organizationId)
      .eq("staff_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(60),
    admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle(),
  ]);
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const rows: TemplateRow[] = MILESTONES.map((milestone) => {
    const saved = (templates ?? []).find((row) => row.milestone === milestone);
    return {
      milestone,
      subject: (saved?.subject as string | undefined) ?? SUGGESTED[milestone].subject,
      body: (saved?.body as string | undefined) ?? SUGGESTED[milestone].body,
      enabled: Boolean(saved?.enabled),
      disabledByAdmin: Boolean(saved?.disabled_by_admin),
      saved: Boolean(saved),
    };
  });
  const day = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(zone).toFormat("ccc, LLL d") : "");
  const toItem = (row: NonNullable<typeof emails>[number]): PendingEmail => ({
    id: row.id as string,
    name: (row.client_name as string | null) ?? "Member",
    count: row.class_count as number,
    className: (row.class_name as string | null) ?? "class",
    when: day(row.class_start as string),
    subject: row.subject as string,
    body: row.body as string,
    status: row.status as string,
    decided: day(row.decided_at as string | null),
  });

  return (
    <DashboardShell
      title="Milestone emails"
      description="A personal note from the instructor when a member reaches their 1st, 3rd, 10th, 25th, 50th or 100th class (and every 100 after). Nothing sends until it's approved."
    >
      <MilestonesEditor
        isAdmin={isAdmin}
        ownerId={ownerId}
        mine={ownerId === staff.id}
        instructors={(instructors ?? []).map((row) => ({
          id: row.id as string,
          name: (row.display_name as string | null) ?? "Instructor",
        }))}
        templates={rows}
        pending={(emails ?? []).filter((row) => row.status === "pending").map(toItem)}
        history={(emails ?? [])
          .filter((row) => row.status !== "pending")
          .slice(0, 20)
          .map(toItem)}
      />
    </DashboardShell>
  );
}
