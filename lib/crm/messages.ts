import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendRelayEmail, formatOutboundMessageId } from "@/lib/email/relay";
import { sendPushToStaff } from "@/lib/push/send";
import { sendSms, withinTextingHours } from "@/lib/crm/sms";
import { getCrmOrg } from "@/lib/crm/org";

// Guest messaging: one thread per guest mixing texts and emails. Outbound
// messages are sent and recorded here; inbound ones arrive through the
// Twilio and Resend webhooks and are recorded by recordInbound().

export const GUEST_ALIAS_PREFIX = "g-";

export class MessageError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function relayDomain(): string {
  const domain = process.env.FOLLOWUP_RELAY_DOMAIN;
  if (!domain) throw new MessageError("Email isn't set up (relay domain missing).", 500);
  return domain;
}

async function emailAliasFor(admin: SupabaseClient, contact: { id: string; organization_id: string; email_alias: string | null }) {
  if (contact.email_alias) return contact.email_alias;
  const alias = `${GUEST_ALIAS_PREFIX}${randomBytes(12).toString("hex")}@${relayDomain()}`;
  const { error } = await admin
    .from("crm_contacts")
    .update({ email_alias: alias })
    .eq("id", contact.id)
    .eq("organization_id", contact.organization_id)
    .is("email_alias", null);
  if (error) throw error;
  return alias;
}

function displayFrom(name: string, address: string): string {
  return `"${name.replace(/["\\\r\n]/g, "")}" <${address}>`;
}

export async function sendGuestMessage(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    staff: { id: string; displayName: string };
    contactId: string;
    channel: "sms" | "email";
    body: string;
    subject?: string | null;
    statusCallbackUrl?: string;
  },
) {
  const { data: contact, error } = await admin
    .from("crm_contacts")
    .select("id, organization_id, first_name, email_normalized, phone_e164, sms_consent, sms_opted_out_at, email_alias, merged_into_id, deleted_at")
    .eq("id", params.contactId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!contact || contact.merged_into_id || contact.deleted_at) throw new MessageError("Guest not found.", 404);

  const org = await getCrmOrg(params.organizationId);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: params.organizationId,
    contact_id: contact.id,
    channel: params.channel,
    direction: "outbound",
    body: params.body,
    sent_by_staff_id: params.staff.id,
    created_at: now,
  };

  if (params.channel === "sms") {
    if (!contact.phone_e164) throw new MessageError("This guest has no mobile number.");
    if (contact.sms_opted_out_at) throw new MessageError("This guest replied STOP, so they can't be texted.");
    if (!contact.sms_consent) throw new MessageError("This guest didn't agree to texts.");
    if (!withinTextingHours(org.timezone)) throw new MessageError("Texts can only be sent between 8 AM and 9 PM.");
    const { data: orgRow } = await admin.from("organizations").select("crm_sms_number").eq("id", params.organizationId).single();
    const result = await sendSms({
      to: contact.phone_e164,
      from: orgRow?.crm_sms_number ?? null,
      body: params.body,
      statusCallback: params.statusCallbackUrl,
    });
    if (!result.ok) {
      if (result.code === 21610) {
        await admin.from("crm_contacts").update({ sms_opted_out_at: now }).eq("id", contact.id);
      }
      throw new MessageError(result.error, 502);
    }
    Object.assign(row, { status: "sent", provider_message_id: result.sid });
  } else {
    if (!contact.email_normalized) throw new MessageError("This guest has no email address.");
    const alias = await emailAliasFor(admin, contact);
    const firstName = params.staff.displayName.split(" ")[0] || params.staff.displayName;

    // Thread onto the guest's latest email so it stays one conversation.
    const { data: last } = await admin
      .from("crm_messages")
      .select("provider_message_id, subject")
      .eq("contact_id", contact.id)
      .eq("channel", "email")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const baseSubject = params.subject?.trim() || last?.subject?.replace(/^re:\s*/i, "") || `Following up from ${org.name}`;
    const subject = last ? `Re: ${baseSubject}` : baseSubject;

    const result = await sendRelayEmail({
      from: displayFrom(`${firstName} at ${org.name}`, alias),
      to: contact.email_normalized,
      replyTo: alias,
      subject,
      text: params.body,
      inReplyTo: last?.provider_message_id ?? null,
    });
    if (!result.ok) throw new MessageError("The email couldn't be sent. Try again.", 502);
    Object.assign(row, {
      subject,
      status: "sent",
      provider_message_id: formatOutboundMessageId(result.resendMessageId),
    });
  }

  const { data: inserted, error: insertError } = await admin.from("crm_messages").insert(row).select("id").single();
  if (insertError) throw insertError;
  await admin.from("crm_contacts").update({ last_message_at: now }).eq("id", contact.id);
  return inserted.id as string;
}

// Who hears about a guest's new message: a member's assigned trainer, else
// their salesperson, or every admin when nobody's assigned.
async function notifyStaff(admin: SupabaseClient, organizationId: string, contactId: string, channel: "sms" | "email") {
  const { data: contact } = await admin
    .from("crm_contacts")
    .select("first_name, last_name, assigned_staff_id, trainer_staff_id")
    .eq("id", contactId)
    .single();
  if (!contact) return;
  const owner = contact.trainer_staff_id ?? contact.assigned_staff_id;
  let staffIds: string[] = owner ? [owner] : [];
  if (staffIds.length === 0) {
    const { data: admins } = await admin
      .from("staff")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .is("archived_at", null);
    staffIds = (admins ?? []).map((row) => row.id);
  }
  await sendPushToStaff(staffIds, {
    title: `New ${channel === "sms" ? "text" : "email"} from ${contact.first_name} ${contact.last_name.charAt(0)}.`,
    body: "Open the guest to reply.",
    url: `/dashboard/guests/${contactId}`,
  });
}

export async function recordInbound(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    contactId: string;
    channel: "sms" | "email";
    body: string;
    subject?: string | null;
    providerMessageId?: string | null;
  },
) {
  const now = new Date().toISOString();
  // Webhooks can be retried; don't record the same provider message twice.
  if (params.providerMessageId) {
    const { count } = await admin
      .from("crm_messages")
      .select("id", { count: "exact", head: true })
      .eq("provider_message_id", params.providerMessageId);
    if ((count ?? 0) > 0) return;
  }
  const { error } = await admin.from("crm_messages").insert({
    organization_id: params.organizationId,
    contact_id: params.contactId,
    channel: params.channel,
    direction: "inbound",
    body: params.body.slice(0, 20000) || "(empty message)",
    subject: params.subject ?? null,
    status: "received",
    provider_message_id: params.providerMessageId ?? null,
    created_at: now,
  });
  if (error) throw error;
  await admin.from("crm_contacts").update({ last_message_at: now }).eq("id", params.contactId);
  await notifyStaff(admin, params.organizationId, params.contactId, params.channel).catch(() => undefined);
}
