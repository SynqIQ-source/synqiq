import { getEnv } from "@/lib/env";
import { extractReplyText } from "@/lib/email/reply-parser";
import { resolveContextByAlias, deliverHop, type FollowupDirection } from "@/lib/followup/relay";

export type InboundEmail = {
  // Sender, either bare ("a@b.com") or "Name <a@b.com>".
  from: string;
  to: string[];
  subject: string;
  text: string;
  // RFC Message-ID header of the received mail, if present.
  messageId: string | null;
};

export type InboundResult =
  | { status: "relayed"; direction: FollowupDirection }
  | { status: "dropped"; reason: string };

function bareEmail(address: string): string {
  const angle = address.match(/<([^>]+)>/);
  return (angle ? angle[1]! : address).trim().toLowerCase();
}

// Pick the recipient that belongs to the relay domain -- an inbound mail
// can carry other To/Cc entries.
function findAlias(recipients: string[]): string | null {
  const domain = getEnv("FOLLOWUP_RELAY_DOMAIN").toLowerCase();
  for (const recipient of recipients) {
    const email = bareEmail(recipient);
    if (email.endsWith(`@${domain}`)) {
      return email;
    }
  }
  return null;
}

// Core inbound relay: resolve the conversation from the alias, decide which
// way the mail is going by matching the sender against the two snapshotted
// addresses, strip quoted history, and relay the remainder to the other
// party. Anything unresolvable is dropped and logged, never relayed.
export async function handleInboundEmail(email: InboundEmail): Promise<InboundResult> {
  const alias = findAlias(email.to);
  if (!alias) {
    return { status: "dropped", reason: "no recipient on the relay domain" };
  }

  const context = await resolveContextByAlias(alias);
  if (!context) {
    return { status: "dropped", reason: `no conversation for alias ${alias}` };
  }

  const sender = bareEmail(email.from);
  const { client_email, instructor_email } = context.conversation;

  let direction: FollowupDirection;
  if (sender === client_email.toLowerCase()) {
    // Member wrote in -> deliver to the instructor.
    direction = "inbound";
  } else if (sender === instructor_email.toLowerCase()) {
    // Instructor replied from their own inbox -> deliver to the member.
    direction = "outbound";
  } else {
    return { status: "dropped", reason: `sender ${sender} matches neither party on ${alias}` };
  }

  const bodyText = extractReplyText(email.text);
  if (!bodyText.trim()) {
    return { status: "dropped", reason: "empty body after quote stripping" };
  }

  const result = await deliverHop({
    context,
    direction,
    bodyText,
    receivedMessageId: email.messageId,
  });

  if (!result.ok) {
    return { status: "dropped", reason: `relay send failed: ${result.error}` };
  }

  return { status: "relayed", direction };
}
