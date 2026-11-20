import { onDomains } from "@/lib/email/domains";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractReplyText } from "@/lib/email/reply-parser";
import { GUEST_ALIAS_PREFIX, recordInbound } from "@/lib/crm/messages";
import { bareEmail, otherSender } from "@/lib/crm/email-sender";

// The guest-thread alias among the recipients, if any (g-<token>@relay domain).
// On SynqIQ's relay domain or a studio's verified reply domain.
export function findGuestAlias(recipients: string[], domains: string[]): string | null {
  if (!domains.length) return null;
  for (const recipient of recipients) {
    const email = bareEmail(recipient);
    if (email.startsWith(GUEST_ALIAS_PREFIX) && onDomains(email, domains)) return email;
  }
  return null;
}

// A reply to a guest's email from SynqIQ: record it in their thread. Any
// sender is accepted -- the alias is a long random code only the guest's
// emails carry, and guests often answer from another address (work vs
// personal). A sender other than the email on file is kept on the message
// (from_address) so the thread shows who wrote it.

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
    fromAddress: otherSender(email.from, contact.email_normalized as string | null),
  });
  return { status: "recorded" };
}
