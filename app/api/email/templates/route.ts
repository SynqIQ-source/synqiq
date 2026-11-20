import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients } from "@/lib/email/send";
import { loadEmailKit, studioFrom } from "@/lib/email/studio-kit";
import {
  BODY_MAX,
  EMAIL_TEMPLATES,
  SUBJECT_MAX,
  emailButton,
  isTemplateKey,
  renderStudioEmail,
  sampleVars,
  unknownPlaceholders,
} from "@/lib/email/studio-templates";

// Club Admins: the studio's email header/footer and template wording, and a
// test send of any template to the admin's own staff email (sample values).
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const now = new Date().toISOString();

  if (body?.action === "save_branding") {
    const { error } = await admin.from("email_settings").upsert({
      organization_id: org,
      signature: text(body.signature, 500) || null,
      footer: text(body.footer, 1000) || null,
      show_logo: body.showLogo !== false,
      updated_by_staff_id: staff.id,
      updated_at: now,
    });
    return error ? fail(error.message, 500) : NextResponse.json({ success: true });
  }

  if (!isTemplateKey(body?.key)) return fail("Unknown email.");
  const key = body.key;

  if (body.action === "save_template") {
    const subject = text(body.subject, SUBJECT_MAX);
    const content = text(body.body, BODY_MAX);
    if (!subject || !content) return fail("Subject and message are both needed.");
    const unknown = unknownPlaceholders(`${subject}\n${content}`, key);
    if (unknown.length)
      return fail(`This email doesn't have ${unknown.map((name) => `{{${name}}}`).join(", ")}. Use the fields listed under the message.`);
    const def = EMAIL_TEMPLATES[key];
    // Saving the default wording unchanged just clears the override.
    if (subject === def.subject && content === def.body) {
      await admin.from("email_templates").delete().eq("organization_id", org).eq("key", key);
      return NextResponse.json({ success: true });
    }
    const { error } = await admin
      .from("email_templates")
      .upsert({ organization_id: org, key, subject, body: content, updated_by_staff_id: staff.id, updated_at: now });
    return error ? fail(error.message, 500) : NextResponse.json({ success: true });
  }

  if (body.action === "reset_template") {
    const { error } = await admin.from("email_templates").delete().eq("organization_id", org).eq("key", key);
    return error ? fail(error.message, 500) : NextResponse.json({ success: true });
  }

  if (body.action === "test") {
    const { data: me } = await admin.from("staff").select("email").eq("id", staff.id).maybeSingle();
    const to = (me?.email as string | null)?.trim();
    if (!to) return fail("Your staff profile has no email address to send the test to.");
    const kit = await loadEmailKit(admin, org);
    const email = renderStudioEmail(key, sampleVars(key), kit, {
      action: emailButton("https://synqiq.co", key === "rating_request" ? "★★★★★" : "Button", kit.branding.color),
    });
    await sendEmailToRecipients([{ email: to }], {
      from: studioFrom(kit.branding.studioName, kit.fromDomain),
      subject: `[Test] ${email.subject}`,
      html: email.html,
    });
    return NextResponse.json({ success: true, email: to });
  }

  return fail("Unknown action.");
}
