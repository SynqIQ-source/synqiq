import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { sendRelayEmail, formatOutboundMessageId } from "@/lib/email/relay";
import { deriveFollowupDisplayName, formatAddress } from "@/lib/followup/display-name";

export type FollowupDirection = "outbound" | "inbound";

// outbound = instructor -> member; inbound = member -> instructor.
type ConversationRow = {
  id: string;
  organization_id: string;
  instructor_id: string;
  client_id: string;
  alias: string;
  client_email: string;
  instructor_email: string;
  subject: string;
};

// Everything a send needs, resolved once so the derived display name and
// addresses are consistent across a hop.
export type FollowupContext = {
  conversation: ConversationRow;
  instructorFirstName: string;
  clientFirstName: string;
  organizationName: string;
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const CONVERSATION_COLUMNS =
  "id, organization_id, instructor_id, client_id, alias, client_email, instructor_email, subject";

function aliasLocalPart(aliasOrAddress: string): string {
  return aliasOrAddress.includes("@") ? aliasOrAddress.split("@")[0]! : aliasOrAddress;
}

function buildAlias(): string {
  return `${randomUUID()}@${getEnv("FOLLOWUP_RELAY_DOMAIN")}`;
}

function withRePrefix(subject: string): string {
  return /^re:\s/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

async function resolveInstructorEmail(admin: Admin, authUserId: string): Promise<string | null> {
  // Supabase Auth login email, NOT staff.email -- staff.email is null for
  // the large majority of prod rows (historic sync gap). auth.users is only
  // reachable via the admin API.
  const { data, error } = await admin.auth.admin.getUserById(authUserId);
  if (error || !data?.user?.email) {
    return null;
  }
  return data.user.email;
}

async function loadContext(admin: Admin, conversation: ConversationRow): Promise<FollowupContext | null> {
  const [{ data: staff }, { data: client }, { data: org }] = await Promise.all([
    admin.from("staff").select("first_name").eq("id", conversation.instructor_id).maybeSingle(),
    admin.from("clients").select("first_name").eq("id", conversation.client_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", conversation.organization_id).maybeSingle(),
  ]);

  if (!staff?.first_name || !client?.first_name || !org?.name) {
    return null;
  }

  return {
    conversation,
    instructorFirstName: staff.first_name,
    clientFirstName: client.first_name,
    organizationName: org.name,
  };
}

export async function resolveContextByAlias(alias: string): Promise<FollowupContext | null> {
  const admin = createSupabaseAdminClient();
  const localPart = aliasLocalPart(alias);

  const { data: conversation } = await admin
    .from("followup_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("alias", `${localPart}@${getEnv("FOLLOWUP_RELAY_DOMAIN")}`)
    .maybeSingle();

  if (!conversation) {
    return null;
  }
  return loadContext(admin, conversation as ConversationRow);
}

export type GetOrCreateResult =
  | { ok: true; context: FollowupContext; created: boolean }
  | { ok: false; error: string };

// Used by the outbound (instructor-composed) path. One conversation per
// (instructor, member) pair; a later follow-up reuses it and just updates
// the subject.
export async function getOrCreateConversation(params: {
  organizationId: string;
  instructorId: string;
  clientId: string;
  subject: string;
}): Promise<GetOrCreateResult> {
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("followup_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("organization_id", params.organizationId)
    .eq("instructor_id", params.instructorId)
    .eq("client_id", params.clientId)
    .maybeSingle();

  if (existing) {
    const context = await loadContext(admin, existing as ConversationRow);
    if (!context) {
      return { ok: false, error: "Conversation is missing its instructor, client, or organization record." };
    }
    return { ok: true, context, created: false };
  }

  const { data: staff } = await admin
    .from("staff")
    .select("auth_user_id")
    .eq("id", params.instructorId)
    .maybeSingle();

  if (!staff?.auth_user_id) {
    return { ok: false, error: "Instructor has no linked login, so no reply address is available." };
  }

  const instructorEmail = await resolveInstructorEmail(admin, staff.auth_user_id);
  if (!instructorEmail) {
    return { ok: false, error: "Could not resolve the instructor's login email." };
  }

  const { data: client } = await admin
    .from("clients")
    .select("email")
    .eq("id", params.clientId)
    .maybeSingle();

  if (!client?.email) {
    return { ok: false, error: "This member has no email on file (only checked-in members get one)." };
  }

  const { data: inserted, error: insertError } = await admin
    .from("followup_conversations")
    .insert({
      organization_id: params.organizationId,
      instructor_id: params.instructorId,
      client_id: params.clientId,
      alias: buildAlias(),
      client_email: client.email,
      instructor_email: instructorEmail,
      subject: params.subject,
    })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? "Failed to create the conversation." };
  }

  const context = await loadContext(admin, inserted as ConversationRow);
  if (!context) {
    return { ok: false, error: "Conversation created but its related records could not be loaded." };
  }
  return { ok: true, context, created: true };
}

type PriorMessage = {
  direction: FollowupDirection;
  resend_message_id: string | null;
  provider_message_id: string | null;
};

// The Message-ID the recipient of a prior hop would have seen, so the next
// hop can cite it in In-Reply-To / References.
function citableMessageId(row: PriorMessage): string | null {
  if (row.provider_message_id) {
    return row.provider_message_id;
  }
  if (row.resend_message_id) {
    return formatOutboundMessageId(row.resend_message_id);
  }
  return null;
}

export type DeliverResult = { ok: true; messageId: string } | { ok: false; error: string };

// One relay hop: send the mail, record the followup_messages row, bump the
// conversation. `direction` is the direction of THIS message
// (outbound = to the member, inbound = to the instructor).
export async function deliverHop(params: {
  context: FollowupContext;
  direction: FollowupDirection;
  bodyText: string;
  // Message-ID of the received email, when this hop started as an inbound
  // relay (null for an instructor-composed first message).
  receivedMessageId?: string | null;
}): Promise<DeliverResult> {
  const { context, direction, bodyText } = params;
  const { conversation } = context;
  const admin = createSupabaseAdminClient();

  const { data: priorRows } = await admin
    .from("followup_messages")
    .select("direction, resend_message_id, provider_message_id, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });

  const prior = (priorRows ?? []) as (PriorMessage & { created_at: string })[];
  const hasPrior = prior.length > 0;
  const references = prior.map(citableMessageId).filter((id): id is string => Boolean(id));
  const parent = prior.length > 0 ? prior[prior.length - 1]! : null;
  const inReplyTo = parent ? citableMessageId(parent) : null;

  const maskedName = deriveFollowupDisplayName(context.instructorFirstName, context.organizationName);

  let from: string;
  let to: string;
  let fromEmail: string;
  let toEmail: string;

  if (direction === "outbound") {
    from = formatAddress(maskedName, conversation.alias);
    to = conversation.client_email;
    fromEmail = conversation.instructor_email;
    toEmail = conversation.client_email;
  } else {
    // The instructor-facing leg. From carries the member's first name so
    // the instructor knows who is writing, but the address is still the
    // alias so their reply routes back through the relay.
    from = formatAddress(context.clientFirstName, conversation.alias);
    to = conversation.instructor_email;
    fromEmail = conversation.client_email;
    toEmail = conversation.instructor_email;
  }

  const subject = hasPrior ? withRePrefix(conversation.subject) : conversation.subject;

  const sendResult = await sendRelayEmail({
    from,
    to,
    replyTo: conversation.alias,
    subject,
    text: bodyText,
    inReplyTo,
    references: references.length > 0 ? references : undefined,
  });

  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }

  const { error: messageError } = await admin.from("followup_messages").insert({
    conversation_id: conversation.id,
    organization_id: conversation.organization_id,
    direction,
    from_email: fromEmail,
    to_email: toEmail,
    body_text: bodyText,
    resend_message_id: sendResult.resendMessageId,
    provider_message_id: params.receivedMessageId ?? null,
    in_reply_to: inReplyTo,
  });

  if (messageError) {
    // The mail already went out; losing the row would desync the thread
    // view but must not look like a send failure to the caller.
    console.error(`[followup] sent hop but failed to record message row: ${messageError.message}`);
  }

  await admin
    .from("followup_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  return { ok: true, messageId: sendResult.resendMessageId };
}

export type SendFollowupResult =
  | { ok: true; conversationId: string; messageId: string }
  | { ok: false; error: string };

// Convenience for the outbound (instructor-composed) path used by
// /api/followup: create/resolve the conversation, optionally refresh the
// subject, then deliver. Returns the conversation id so the caller can
// link the sender straight to the thread view.
export async function sendInstructorFollowup(params: {
  organizationId: string;
  instructorId: string;
  clientId: string;
  subject: string;
  bodyText: string;
}): Promise<SendFollowupResult> {
  const conversation = await getOrCreateConversation({
    organizationId: params.organizationId,
    instructorId: params.instructorId,
    clientId: params.clientId,
    subject: params.subject,
  });

  if (!conversation.ok) {
    return { ok: false, error: conversation.error };
  }

  const conversationId = conversation.context.conversation.id;

  if (!conversation.created && conversation.context.conversation.subject !== params.subject) {
    const admin = createSupabaseAdminClient();
    await admin
      .from("followup_conversations")
      .update({ subject: params.subject })
      .eq("id", conversationId);
    conversation.context.conversation.subject = params.subject;
  }

  const delivered = await deliverHop({
    context: conversation.context,
    direction: "outbound",
    bodyText: params.bodyText,
  });

  if (!delivered.ok) {
    return { ok: false, error: delivered.error };
  }

  return { ok: true, conversationId, messageId: delivered.messageId };
}
