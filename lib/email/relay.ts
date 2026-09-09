import { getEnv } from "@/lib/env";

// A SEPARATE send path from lib/email/send.ts. That module hits Resend's
// /emails/batch endpoint and only ever overrides `from` -- it has no
// Reply-To and no threading headers, and it is deliberately fire-and-forget
// (a failed notification must never fail its caller). The relay is the
// opposite on every count: single-recipient, needs `reply_to` set to the
// conversation alias, needs In-Reply-To / References to keep the thread
// stitched in both inboxes, and its caller DOES need to know whether the
// send succeeded (so the message row and thread state stay truthful).
const RESEND_SEND_URL = "https://api.resend.com/emails";

export type RelaySendParams = {
  // Fully-formed From, e.g. `"Jamie at The Preserve Houston" <abc@followup.synqiq.co>`.
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  // RFC Message-ID of the message this one is a reply to (already in
  // `<...>` form), plus the running References chain.
  inReplyTo?: string | null;
  references?: string[];
};

export type RelaySendResult =
  | { ok: true; resendMessageId: string }
  | { ok: false; error: string };

export async function sendRelayEmail(params: RelaySendParams): Promise<RelaySendResult> {
  const apiKey = getEnv("RESEND_API_KEY");

  const headers: Record<string, string> = {};
  if (params.inReplyTo) {
    headers["In-Reply-To"] = params.inReplyTo;
    const chain = params.references && params.references.length > 0 ? params.references : [params.inReplyTo];
    headers["References"] = chain.join(" ");
  }

  try {
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        reply_to: params.replyTo,
        subject: params.subject,
        text: params.text,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Resend send failed: ${response.status} ${response.statusText} -- ${bodyText}`,
      };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!data?.id) {
      return { ok: false, error: "Resend send returned no message id" };
    }

    return { ok: true, resendMessageId: data.id };
  } catch (sendError) {
    return {
      ok: false,
      error: sendError instanceof Error ? sendError.message : String(sendError),
    };
  }
}

// Resend's POST /emails returns its own opaque `id`, not the RFC Message-ID
// header the recipient's mail client threads on. Empirically Resend derives
// the Message-ID as `<{id}@{from-domain}>`; we rebuild it here so the next
// leg can cite it in In-Reply-To.
//
// VERIFY against a real Resend test event before trusting threading in
// prod -- if the observed Message-ID format differs, this is the one spot
// to adjust.
export function formatOutboundMessageId(resendMessageId: string): string {
  return `<${resendMessageId}@${getEnv("FOLLOWUP_RELAY_DOMAIN")}>`;
}
