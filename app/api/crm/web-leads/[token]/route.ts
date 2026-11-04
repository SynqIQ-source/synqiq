import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/crm/kiosk-auth";
import { isCrmEnabled } from "@/lib/crm/module";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { enqueueEmailCheck, runJobById } from "@/lib/crm/jobs";
import { recordInbound } from "@/lib/crm/messages";
import { jsonError, logCrmError } from "@/lib/crm/http";
import { flattenFields, parseWebLead, webLeadThreadBody } from "@/lib/crm/web-leads";

const MAX_BYTES = 64_000;

type RouteParams = { params: Promise<{ token: string }> };

type LeadForm = {
  id: string;
  organization_id: string;
  name: string;
  how_heard_label: string | null;
  assigned_staff_id: string | null;
  submission_count: number;
};

// The active form for this URL token, in an org that has the CRM; else null.
// The organization always comes from the token, never from the body.
async function findForm(token: string): Promise<LeadForm | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("crm_lead_forms")
    .select("id, organization_id, name, how_heard_label, assigned_staff_id, submission_count, revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (!(await isCrmEnabled(data.organization_id))) return null;
  return data;
}

async function readFields(request: NextRequest): Promise<Map<string, string> | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return null;
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (type.includes("multipart/form-data")) {
    const form = await new Request("http://local", { method: "POST", headers: { "content-type": type }, body: raw })
      .formData()
      .catch(() => null);
    if (!form) return null;
    const record: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") record[key] = value;
    }
    return flattenFields(record);
  }

  const trimmed = raw.trim();
  if (type.includes("json") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? flattenFields(parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  // application/x-www-form-urlencoded (or unlabeled key=value pairs).
  const params = new URLSearchParams(trimmed);
  const record: Record<string, unknown> = {};
  for (const [key, value] of params) {
    // A checkbox posts a hidden "" then "1"; keep the last non-empty value.
    if (value || !(key in record)) record[key] = value;
  }
  return flattenFields(record);
}

// Lets someone check the URL in a browser before wiring up the form.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const form = await findForm(token);
  if (!form) return jsonError("Not found.", 404);
  return NextResponse.json({ success: true, form: form.name, message: "Ready to receive website leads (POST)." });
}

// A website form submission becomes a web lead in the CRM. Public by design:
// the long random token in the URL is the credential. A visitor who is
// already in the CRM (same email or phone) isn't duplicated; their message is
// added to their existing thread instead. Either way the message lands in
// the guest's thread as an unread inbound "web" message and the owner (or
// every admin when unassigned) gets a push notification.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const form = await findForm(token);
    if (!form) return jsonError("Not found.", 404);

    // Per form, not per IP: server-side senders (Freeform, Zapier) post every
    // lead from the same address.
    const allowed = await rateLimitAll([
      { key: `web-lead:form:${form.id}`, windowSeconds: 3_600, limit: 120 },
      { key: `web-lead:form-day:${form.id}`, windowSeconds: 86_400, limit: 1_000 },
    ]);
    if (!allowed) return jsonError("Too many submissions. Try again later.", 429);

    const fields = await readFields(request);
    if (!fields) return jsonError("Couldn't read the form submission.", 400);
    const lead = parseWebLead(fields);
    if (!lead.email && !lead.phone) {
      return jsonError("The submission needs an email address or phone number.", 422);
    }

    const admin = createSupabaseAdminClient();
    const organizationId = form.organization_id;
    // Retries of the same submission are recorded once: by the sender's own
    // submission id when it sends one, else by the exact payload.
    const fingerprint = lead.submissionId
      ? `web:${form.id}:${lead.submissionId}`
      : `web:${form.id}:${sha256(JSON.stringify([...fields.entries()]))}`;
    const { count: seen } = await admin
      .from("crm_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("provider_message_id", fingerprint);
    if ((seen ?? 0) > 0) return NextResponse.json({ success: true, duplicate: true });

    const filters = [
      lead.email ? `email_normalized.eq.${lead.email}` : null,
      lead.phone ? `phone_e164.eq.${lead.phone}` : null,
    ].filter(Boolean);
    const { data: existing, error: matchError } = await admin
      .from("crm_contacts")
      .select("id, email, phone_e164, email_consent, sms_consent")
      .eq("organization_id", organizationId)
      .is("merged_into_id", null)
      .is("deleted_at", null)
      .or(filters.join(","))
      .order("created_at", { ascending: true })
      .limit(1);
    if (matchError) throw matchError;
    const match = existing?.[0] ?? null;
    const now = new Date().toISOString();

    let contactId: string;
    let isNewLead = false;
    if (match) {
      contactId = match.id;
      // Fill gaps and record new opt-ins; never overwrite what staff have.
      const updates: Record<string, unknown> = {};
      if (!match.email && lead.email) Object.assign(updates, { email: lead.email, email_normalized: lead.email });
      if (!match.phone_e164 && lead.phone) updates.phone_e164 = lead.phone;
      if (lead.emailConsent && !match.email_consent) Object.assign(updates, { email_consent: true, email_consent_at: now });
      if (lead.smsConsent && !match.sms_consent) Object.assign(updates, { sms_consent: true, sms_consent_at: now });
      if (Object.keys(updates).length) {
        const { error } = await admin
          .from("crm_contacts")
          .update({ ...updates, updated_at: now })
          .eq("id", contactId)
          .eq("organization_id", organizationId);
        // Another contact may already own this email/phone; the lead's message
        // still gets recorded below.
        if (error) logCrmError("crm/web-leads fill-in", error);
      }
    } else {
      let assignedStaffId: string | null = null;
      if (form.assigned_staff_id) {
        const { data: owner } = await admin
          .from("staff")
          .select("id")
          .eq("id", form.assigned_staff_id)
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .maybeSingle();
        assignedStaffId = owner?.id ?? null;
      }
      const { data: created, error } = await admin
        .from("crm_contacts")
        .insert({
          organization_id: organizationId,
          first_name: lead.firstName,
          last_name: lead.lastName,
          email: lead.email,
          email_normalized: lead.email,
          phone_e164: lead.phone,
          status: "lead",
          source: "web",
          how_heard: form.how_heard_label ? [form.how_heard_label] : [],
          assigned_staff_id: assignedStaffId,
          email_consent: lead.emailConsent,
          email_consent_at: lead.emailConsent ? now : null,
          sms_consent: lead.smsConsent,
          sms_consent_at: lead.smsConsent ? now : null,
          email_check_status: lead.email ? "pending" : "skipped",
          created_by_lead_form_id: form.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      contactId = created.id;
      isNewLead = true;

      if (lead.email) {
        const jobId = await enqueueEmailCheck(admin, organizationId, contactId);
        after(() => runJobById(jobId));
      }
    }

    await recordInbound(admin, {
      organizationId,
      contactId,
      channel: "web",
      subject: `Website: ${form.name}`,
      body: webLeadThreadBody(lead, form.name),
      providerMessageId: fingerprint,
      isNewLead,
    });

    await admin
      .from("crm_lead_forms")
      .update({ last_received_at: now, submission_count: form.submission_count + 1 })
      .eq("id", form.id);

    return NextResponse.json({ success: true, created: isNewLead });
  } catch (error) {
    logCrmError("crm/web-leads POST", error);
    return jsonError("Couldn't save the lead.", 500);
  }
}
