import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOptionalEnv } from "@/lib/env";
import { newToken, hashToken } from "@/lib/member/password";
import { sendEmailMessages } from "@/lib/email/send";
import { loadEmailKit, studioFrom } from "@/lib/email/studio-kit";
import { cleanFilters, renderNewsletter, type NewsletterFilters } from "@/lib/email/newsletter-content";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type AudienceRow = { contact_id: string; email: string; first_name: string | null };

const siteUrl = () => getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";

// Everyone the filters match who opted in to email and hasn't unsubscribed
// (database function newsletter_audience).
export async function newsletterAudience(admin: Admin, organizationId: string, filters: NewsletterFilters): Promise<AudienceRow[]> {
  const rows: AudienceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .rpc("newsletter_audience", { p_org: organizationId, p_filters: cleanFilters(filters) })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as AudienceRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

// A test to the admin's own staff email (unsubscribe link goes to a test page).
export async function sendNewsletterTest(organizationId: string, staffId: string, subject: string, body: string) {
  const admin = createSupabaseAdminClient();
  const [{ data: me }, kit] = await Promise.all([
    admin.from("staff").select("email, display_name").eq("id", staffId).maybeSingle(),
    loadEmailKit(admin, organizationId),
  ]);
  const to = (me?.email as string | null)?.trim();
  if (!to) return { error: "Your staff profile has no email address to send the test to." };
  const email = renderNewsletter(kit, subject, body, {
    firstName: ((me?.display_name as string | null) ?? "").split(" ")[0] || null,
    unsubscribeUrl: `${siteUrl()}/u/test`,
  });
  const result = await sendEmailMessages([
    { to, from: studioFrom(kit.branding.studioName), subject: `[Test] ${email.subject}`, html: email.html },
  ]);
  return result.sent.length ? { email: to } : { error: "The test didn't send. Try again in a minute." };
}

// Sends one newsletter that is due: claims it (scheduled -> sending), works
// out the recipients now, records each with its own unsubscribe link, then
// sends in batches. A newsletter is only ever sent once.
export async function sendNewsletter(newsletterId: string, now = new Date()) {
  const admin = createSupabaseAdminClient();
  const { data: claimed } = await admin
    .from("newsletters")
    .update({ status: "sending", started_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", newsletterId)
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .select("id, organization_id, subject, body, filters")
    .maybeSingle();
  if (!claimed) return { skipped: true };
  const organizationId = claimed.organization_id as string;
  const [audience, kit] = await Promise.all([
    newsletterAudience(admin, organizationId, (claimed.filters ?? {}) as NewsletterFilters),
    loadEmailKit(admin, organizationId),
  ]);
  const people = audience.map((row) => ({ ...row, ...newToken() }));
  for (let i = 0; i < people.length; i += 500) {
    const { error } = await admin.from("newsletter_recipients").insert(
      people.slice(i, i + 500).map((person) => ({
        newsletter_id: newsletterId,
        contact_id: person.contact_id,
        organization_id: organizationId,
        email: person.email,
        unsubscribe_token_hash: person.hash,
      })),
    );
    if (error) throw new Error(error.message);
  }
  await admin.from("newsletters").update({ recipient_count: people.length }).eq("id", newsletterId);

  const from = studioFrom(kit.branding.studioName);
  let sentCount = 0;
  let failedCount = 0;
  for (let i = 0; i < people.length; i += 100) {
    const batch = people.slice(i, i + 100);
    const messages = batch.map((person) => {
      const unsubscribeUrl = `${siteUrl()}/u/${person.token}`;
      const email = renderNewsletter(kit, claimed.subject as string, claimed.body as string, {
        firstName: person.first_name,
        unsubscribeUrl,
      });
      return {
        to: person.email,
        from,
        ...email,
        headers: {
          "List-Unsubscribe": `<${siteUrl()}/api/unsubscribe/${person.token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    });
    const result = await sendEmailMessages(messages);
    const sentAt = new Date().toISOString();
    const sentIds = batch.filter((person) => result.sent.includes(person.email)).map((person) => person.contact_id);
    const failedIds = batch.filter((person) => !result.sent.includes(person.email)).map((person) => person.contact_id);
    if (sentIds.length)
      await admin
        .from("newsletter_recipients")
        .update({ status: "sent", sent_at: sentAt })
        .eq("newsletter_id", newsletterId)
        .in("contact_id", sentIds);
    if (failedIds.length)
      await admin.from("newsletter_recipients").update({ status: "failed" }).eq("newsletter_id", newsletterId).in("contact_id", failedIds);
    sentCount += sentIds.length;
    failedCount += failedIds.length;
    await admin.from("newsletters").update({ sent_count: sentCount, failed_count: failedCount }).eq("id", newsletterId);
    // Stay under Resend's request rate.
    if (i + 100 < people.length) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  await admin
    .from("newsletters")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", newsletterId);
  return { recipients: people.length, sent: sentCount, failed: failedCount };
}

// Cron: every newsletter whose time has come.
export async function sendDueNewsletters(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("newsletters")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for")
    .limit(5);
  const results = [];
  for (const row of data ?? []) results.push({ id: row.id, ...(await sendNewsletter(row.id as string, now)) });
  return results;
}

// The recipient behind an unsubscribe link.
export async function findUnsubscribe(token: string) {
  if (!token || token.length > 200 || token === "test") return null;
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("newsletter_recipients")
    .select("newsletter_id, contact_id, organization_id, email, unsubscribed_at")
    .eq("unsubscribe_token_hash", hashToken(token))
    .maybeSingle();
  if (!row) return null;
  const { data: org } = await admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle();
  return { ...row, studioName: (org?.name as string | null) ?? "this studio" };
}

// Stops all marketing email from the studio to that address: the address goes
// on the studio's unsubscribe list and the contact's email consent is turned off.
export async function unsubscribe(token: string): Promise<boolean> {
  const row = await findUnsubscribe(token);
  if (!row) return false;
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  // The contact's own normalized address (the CRM's rule), else lower-case.
  const { data: contact } = await admin.from("crm_contacts").select("email_normalized").eq("id", row.contact_id).maybeSingle();
  const normalized = (contact?.email_normalized as string | null) ?? (row.email as string).trim().toLowerCase();
  await admin
    .from("email_unsubscribes")
    .upsert(
      { organization_id: row.organization_id, email_normalized: normalized, newsletter_id: row.newsletter_id },
      { ignoreDuplicates: true },
    );
  await admin
    .from("newsletter_recipients")
    .update({ unsubscribed_at: now })
    .eq("newsletter_id", row.newsletter_id)
    .eq("contact_id", row.contact_id)
    .is("unsubscribed_at", null);
  await admin
    .from("crm_contacts")
    .update({ email_consent: false, updated_at: now })
    .eq("organization_id", row.organization_id)
    .eq("email_normalized", normalized);
  return true;
}
