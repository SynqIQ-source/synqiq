import { after } from "next/server";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enqueueEmailCheck, runJobById } from "@/lib/crm/jobs";
import { recordInbound } from "@/lib/crm/messages";
import { logCrmError } from "@/lib/crm/http";
import { webLeadThreadBody, type WebLead } from "@/lib/crm/web-leads";

// Saves a website form submission as a web lead (or adds it to the existing
// guest with the same email/phone). Used by the form endpoint and when a
// Club Admin releases a submission that was held as spam.

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type LeadFormRow = {
  id: string;
  organization_id: string;
  name: string;
  how_heard_label: string | null;
  assigned_staff_id: string | null;
  submission_count: number;
};

export async function saveWebLead(admin: Admin, form: LeadFormRow, lead: WebLead, fingerprint: string) {
  const organizationId = form.organization_id;
  const { count: seen } = await admin
    .from("crm_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("provider_message_id", fingerprint);
  if ((seen ?? 0) > 0) return { duplicate: true, created: false, contactId: null as string | null };

  const filters = [lead.email ? `email_normalized.eq.${lead.email}` : null, lead.phone ? `phone_e164.eq.${lead.phone}` : null].filter(
    Boolean,
  );
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

  return { duplicate: false, created: isNewLead, contactId: contactId as string | null };
}
