import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NEWSLETTER_BODY_MAX, NEWSLETTER_SUBJECT_MAX, cleanFilters } from "@/lib/email/newsletter-content";
import { newsletterAudience, sendNewsletterTest } from "@/lib/email/newsletters";

// Club Admins: newsletter drafts, live recipient count, test to self,
// schedule / unschedule. Sending happens in the cron (/api/email/newsletters/run).
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").slice(0, max) : "");

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id : null;
  const now = new Date().toISOString();

  if (body?.action === "count") {
    const audience = await newsletterAudience(admin, org, cleanFilters(body.filters));
    return NextResponse.json({ success: true, count: audience.length });
  }

  if (body?.action === "test") {
    const subject = text(body.subject, NEWSLETTER_SUBJECT_MAX).trim();
    const content = text(body.body, NEWSLETTER_BODY_MAX).trim();
    if (!subject || !content) return fail("Add a subject and a message first.");
    const result = await sendNewsletterTest(org, staff.id, subject, content);
    return "error" in result ? fail(result.error ?? "The test didn't send.") : NextResponse.json({ success: true, email: result.email });
  }

  if (body?.action === "create") {
    const { data, error } = await admin
      .from("newsletters")
      .insert({ organization_id: org, created_by_staff_id: staff.id, filters: {} })
      .select("id")
      .single();
    return error ? fail(error.message, 500) : NextResponse.json({ success: true, id: data.id });
  }

  if (!id) return fail("Newsletter not found.");
  const { data: current } = await admin.from("newsletters").select("status").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!current) return fail("Newsletter not found.", 404);

  if (body?.action === "save") {
    if (current.status !== "draft") return fail("Only drafts can be changed. Unschedule it first.");
    const { error } = await admin
      .from("newsletters")
      .update({
        subject: text(body.subject, NEWSLETTER_SUBJECT_MAX),
        body: text(body.body, NEWSLETTER_BODY_MAX),
        filters: cleanFilters(body.filters),
        updated_at: now,
      })
      .eq("id", id)
      .eq("status", "draft");
    return error ? fail(error.message, 500) : NextResponse.json({ success: true });
  }

  if (body?.action === "schedule") {
    if (current.status !== "draft") return fail("This newsletter is already scheduled or sent.");
    const [{ data: draft }, { data: org_ }, { data: settings }] = await Promise.all([
      admin.from("newsletters").select("subject, body, filters").eq("id", id).maybeSingle(),
      admin.from("organizations").select("timezone").eq("id", org).maybeSingle(),
      admin.from("email_settings").select("footer").eq("organization_id", org).maybeSingle(),
    ]);
    if (!(draft?.subject as string)?.trim() || !(draft?.body as string)?.trim())
      return fail("Add a subject and a message, and save, first.");
    if (!(settings?.footer as string | null)?.trim())
      return fail("Add your studio's mailing address to the email footer (Email > Templates) first. Marketing emails must include it.");
    const zone = (org_?.timezone as string | null) ?? "America/Chicago";
    const when = typeof body.when === "string" ? DateTime.fromISO(body.when, { zone }) : null;
    if (!when?.isValid) return fail("Pick a date and time to send.");
    if (when.toMillis() < Date.now() - 60_000) return fail("Pick a time in the future (or now).");
    if (when.toMillis() > Date.now() + 90 * 86_400_000) return fail("Pick a time within the next 90 days.");
    const audience = await newsletterAudience(admin, org, (draft?.filters ?? {}) as Record<string, unknown>);
    if (!audience.length) return fail("Nobody matches these filters.");
    const { error } = await admin
      .from("newsletters")
      .update({
        status: "scheduled",
        scheduled_for: when.toUTC().toISO(),
        scheduled_by_staff_id: staff.id,
        recipient_count: audience.length,
        updated_at: now,
      })
      .eq("id", id)
      .eq("status", "draft");
    return error ? fail(error.message, 500) : NextResponse.json({ success: true, count: audience.length });
  }

  if (body?.action === "unschedule") {
    const { data, error } = await admin
      .from("newsletters")
      .update({ status: "draft", scheduled_for: null, scheduled_by_staff_id: null, updated_at: now })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id");
    if (error) return fail(error.message, 500);
    return data?.length ? NextResponse.json({ success: true }) : fail("It has already started sending.");
  }

  if (body?.action === "delete") {
    const { data } = await admin.from("newsletters").delete().eq("id", id).eq("status", "draft").select("id");
    return data?.length ? NextResponse.json({ success: true }) : fail("Only drafts can be deleted.");
  }

  return fail("Unknown action.");
}
