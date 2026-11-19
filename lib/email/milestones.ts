import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberEmail } from "@/lib/billing/notify";
import { sendEmailMessages } from "@/lib/email/send";
import { loadEmailKit } from "@/lib/email/studio-kit";
import { fillMilestone, milestoneFor, ordinal, renderMilestoneEmail } from "@/lib/email/milestone-content";

// Nightly: members who reached a class milestone in the last few days get a
// pending email from the instructor who taught that class, if that
// instructor has that milestone turned on. Nothing is sent until the
// instructor (or a Club Admin) approves it. Pending emails expire after 14 days.
export const LOOKBACK_DAYS = 3;
export const EXPIRE_DAYS = 14;

export async function queueMilestones(organizationId: string, now = new Date()) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("milestone_emails")
    .update({ status: "expired", decided_at: now.toISOString() })
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .lt("created_at", new Date(now.getTime() - EXPIRE_DAYS * 86_400_000).toISOString());

  const { data: templates } = await admin
    .from("milestone_templates")
    .select("staff_id, milestone, subject, body")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .eq("disabled_by_admin", false);
  if (!templates?.length) return { queued: 0 };
  const templateFor = new Map(templates.map((row) => [`${row.staff_id}|${row.milestone}`, row]));

  const { data: hits, error } = await admin.rpc("class_milestones", {
    p_org: organizationId,
    p_since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  const rows = (hits ?? []) as {
    mindbody_client_id: string;
    staff_id: string;
    class_name: string | null;
    class_start: string;
    class_count: number;
  }[];
  if (!rows.length) return { queued: 0 };

  const [{ data: org }, { data: staff }, { data: already }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    admin.from("staff").select("id, display_name").eq("organization_id", organizationId),
    admin
      .from("milestone_emails")
      .select("mindbody_client_id, class_count")
      .eq("organization_id", organizationId)
      .in(
        "mindbody_client_id",
        rows.map((row) => row.mindbody_client_id),
      ),
  ]);
  const done = new Set((already ?? []).map((row) => `${row.mindbody_client_id}|${row.class_count}`));
  const staffName = new Map((staff ?? []).map((row) => [row.id as string, ((row.display_name as string | null) ?? "").split(" ")[0]]));
  let queued = 0;
  for (const hit of rows) {
    const milestone = milestoneFor(hit.class_count);
    const template = milestone ? templateFor.get(`${hit.staff_id}|${milestone}`) : undefined;
    if (!template || done.has(`${hit.mindbody_client_id}|${hit.class_count}`)) continue;
    const contact = await memberEmail(admin, organizationId, hit.mindbody_client_id);
    const { data: client } = await admin
      .from("clients")
      .select("first_name, last_name")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", hit.mindbody_client_id)
      .maybeSingle();
    const vars = {
      first_name: contact.firstName || "there",
      count: ordinal(hit.class_count),
      class_name: hit.class_name?.trim() || "class",
      instructor: staffName.get(hit.staff_id) || "your instructor",
      studio: (org?.name as string | null) ?? "the studio",
    };
    const { error: insertError } = await admin.from("milestone_emails").insert({
      organization_id: organizationId,
      staff_id: hit.staff_id,
      mindbody_client_id: hit.mindbody_client_id,
      client_name: client ? `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim() : null,
      class_count: hit.class_count,
      class_name: hit.class_name?.trim() || null,
      class_start: hit.class_start,
      subject: fillMilestone(template.subject as string, vars),
      body: fillMilestone(template.body as string, vars),
    });
    if (!insertError) queued += 1;
  }
  return { queued };
}

// Approve and send one (the instructor's own, or any for a Club Admin). The
// email is claimed first so it can only go once.
export async function sendMilestone(
  organizationId: string,
  actor: { id: string; admin: boolean },
  id: string,
  edited: { subject: string; body: string },
): Promise<{ error: string } | { email: string }> {
  const admin = createSupabaseAdminClient();
  let claim = admin
    .from("milestone_emails")
    .update({
      status: "sent",
      subject: edited.subject,
      body: edited.body,
      decided_by_staff_id: actor.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("status", "pending");
  if (!actor.admin) claim = claim.eq("staff_id", actor.id);
  const { data: row } = await claim.select("staff_id, mindbody_client_id").maybeSingle();
  if (!row) return { error: "This email was already handled or isn't yours." };

  const fail = async (error: string) => {
    await admin.from("milestone_emails").update({ status: "failed" }).eq("id", id);
    return { error };
  };
  const contact = await memberEmail(admin, organizationId, row.mindbody_client_id as string);
  if (!contact.email) return fail("This member has no email address on file.");
  const { data: unsub } = await admin
    .from("email_unsubscribes")
    .select("email_normalized")
    .eq("organization_id", organizationId)
    .eq("email_normalized", contact.email.trim().toLowerCase())
    .maybeSingle();
  if (unsub) return fail("This member unsubscribed from the studio's emails.");
  const [kit, { data: instructor }] = await Promise.all([
    loadEmailKit(admin, organizationId),
    admin.from("staff").select("display_name").eq("id", row.staff_id).maybeSingle(),
  ]);
  const first = (((instructor?.display_name as string | null) ?? "").split(" ")[0] || "Your instructor").replace(/[<>"]/g, "");
  const email = renderMilestoneEmail(kit, edited.subject, edited.body);
  const result = await sendEmailMessages([
    { to: contact.email, from: `${first} at ${kit.branding.studioName.replace(/[<>"]/g, "")} <notifications@synqiq.co>`, ...email },
  ]);
  if (!result.sent.length) return fail("The email didn't send. Try again later.");
  await admin.from("milestone_emails").update({ sent_to: contact.email }).eq("id", id);
  return { email: contact.email };
}
