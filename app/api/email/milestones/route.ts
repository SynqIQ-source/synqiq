import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin, isInstructorAccess } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailMessages } from "@/lib/email/send";
import { loadEmailKit } from "@/lib/email/studio-kit";
import { sendMilestone } from "@/lib/email/milestones";
import { fillMilestone, isMilestone, renderMilestoneEmail, unknownMilestoneFields } from "@/lib/email/milestone-content";

// Instructors: their own milestone emails (templates, approve/edit, skip,
// test to self). Club Admins: anyone's, and can turn any template off.
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isInstructorAccess(staff)) return fail("Instructors only.", 403);
  const isAdmin = isClubAdmin(staff);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  // Whose templates: your own, or (Club Admins) the instructor picked.
  const owner = isAdmin && typeof body?.staffId === "string" && UUID.test(body.staffId) ? body.staffId : staff.id;
  if (owner !== staff.id) {
    const { data: other } = await admin.from("staff").select("id").eq("id", owner).eq("organization_id", org).maybeSingle();
    if (!other) return fail("Instructor not found.");
  }

  if (body?.action === "save_template" || body?.action === "test") {
    if (!isMilestone(body.milestone) && body.action === "save_template") return fail("Unknown milestone.");
    const subject = text(body.subject, 200);
    const content = text(body.body, 5000);
    if (!subject || !content) return fail("Add a subject and a message.");
    const unknown = unknownMilestoneFields(`${subject}\n${content}`);
    if (unknown.length) return fail(`${unknown.map((name) => `{{${name}}}`).join(", ")} isn't one of the fields you can use.`);
    if (body.action === "test") {
      const [{ data: me }, kit] = await Promise.all([
        admin.from("staff").select("email, display_name").eq("id", staff.id).maybeSingle(),
        loadEmailKit(admin, org),
      ]);
      const to = (me?.email as string | null)?.trim();
      if (!to) return fail("Your staff profile has no email address to send the test to.");
      const vars = {
        first_name: "Sam",
        count: "10th",
        class_name: "Power Flow",
        instructor: ((me?.display_name as string) ?? "").split(" ")[0],
        studio: kit.branding.studioName,
      };
      const email = renderMilestoneEmail(kit, fillMilestone(subject, vars), fillMilestone(content, vars));
      const result = await sendEmailMessages([
        { to, from: `SynqIQ <notifications@synqiq.co>`, subject: `[Test] ${email.subject}`, html: email.html },
      ]);
      return result.sent.length ? NextResponse.json({ success: true, email: to }) : fail("The test didn't send.");
    }
    const { error } = await admin.from("milestone_templates").upsert({
      organization_id: org,
      staff_id: owner,
      milestone: body.milestone,
      subject,
      body: content,
      enabled: body.enabled === true,
      updated_by_staff_id: staff.id,
      updated_at: new Date().toISOString(),
    });
    return error ? fail(error.message, 500) : NextResponse.json({ success: true });
  }

  if (body?.action === "admin_disable") {
    if (!isAdmin) return fail("Club Admins only.", 403);
    if (!isMilestone(body.milestone)) return fail("Unknown milestone.");
    const { data, error } = await admin
      .from("milestone_templates")
      .update({ disabled_by_admin: body.disabled === true, updated_by_staff_id: staff.id, updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("staff_id", owner)
      .eq("milestone", body.milestone)
      .select("milestone");
    if (error) return fail(error.message, 500);
    return data?.length ? NextResponse.json({ success: true }) : fail("Save the email first.");
  }

  const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return fail("Email not found.");

  if (body?.action === "send") {
    const subject = text(body.subject, 200);
    const content = text(body.body, 5000);
    if (!subject || !content) return fail("Add a subject and a message.");
    const result = await sendMilestone(org, { id: staff.id, admin: isAdmin }, id, { subject, body: content });
    return "error" in result ? fail(result.error ?? "Didn't send.") : NextResponse.json({ success: true, email: result.email });
  }

  if (body?.action === "skip") {
    let query = admin
      .from("milestone_emails")
      .update({ status: "skipped", decided_by_staff_id: staff.id, decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", org)
      .eq("status", "pending");
    if (!isAdmin) query = query.eq("staff_id", staff.id);
    const { data } = await query.select("id");
    return data?.length ? NextResponse.json({ success: true }) : fail("This email was already handled or isn't yours.");
  }

  return fail("Unknown action.");
}
