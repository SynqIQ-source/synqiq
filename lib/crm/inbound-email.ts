import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractReplyText } from "@/lib/email/reply-parser";
import { GUEST_ALIAS_PREFIX, recordInbound } from "@/lib/crm/messages";

function bareEmail(address: string): string {
  const angle = address.match(/<([^>]+)>/);
  return (angle ? angle[1]! : address).trim().toLowerCase();
}

// The guest-thread alias among the recipients, if any (g-<token>@relay domain).
export function findGuestAlias(recipients: string[]): string | null {
  const domain = (process.env.FOLLOWUP_RELAY_DOMAIN ?? "").toLowerCase();
  if (!domain) return null;
  for (const recipient of recipients) {
    const email = bareEmail(recipient);
    if (email.startsWith(GUEST_ALIAS_PREFIX) && email.endsWith(`@${domain}`)) return email;
  }
  return null;
}

// A guest replied to an email from SynqIQ: record it in their thread. Only
// accepted from the guest's own address on file, so nobody else can post
// into a thread by guessing an alias.
export async function handleGuestEmailReply(email: {
  alias: string;
  from: string;
  subject: string;
  text: string;
  messageId: string | null;
}): Promise<{ status: "recorded" } | { status: "dropped"; reason: string }> {
  const admin = createSupabaseAdminClient();
  const { data: contact } = await admin
    .from("crm_contacts")
    .select("id, organization_id, email_normalized, merged_into_id")
    .eq("email_alias", email.alias)
    .maybeSingle();
  if (!contact) return { status: "dropped", reason: "unknown guest alias" };
  if (bareEmail(email.from) !== contact.email_normalized) {
    return { status: "dropped", reason: "sender isn't the guest's email on file" };
  }

  const body = extractReplyText(email.text).trim();
  if (!body) return { status: "dropped", reason: "empty body after quote stripping" };

  await recordInbound(admin, {
    organizationId: contact.organization_id,
    // Replies to a merged-away guest land on the guest they were merged into.
    contactId: contact.merged_into_id ?? contact.id,
    channel: "email",
    body,
    subject: email.subject,
    providerMessageId: email.messageId,
  });
  return { status: "recorded" };
}
