import { getEnv } from "@/lib/env";

export type EmailRecipient = { email: string; displayName?: string | null };
// `from` is optional per-send override -- everything today uses the
// default (notifications@), but the lead auto-response sends as
// noreply@ / "SynqIQ Support" instead, a distinct sender identity for a
// visitor-facing reply rather than an internal notification.
export type EmailPayload = { subject: string; html: string; from?: string };

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const FROM_ADDRESS = "SynqIQ <notifications@synqiq.co>";

// Resend's batch endpoint, not one call per recipient -- each recipient
// gets their own message object (a shared "to" array would expose every
// other recipient's address to everyone in the send), but batching still
// means one HTTP round trip for the whole group instead of N. Capped at
// 100 per Resend's own batch limit, chunked if a group is ever larger.
const BATCH_LIMIT = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Best-effort, never throws -- same convention as lib/push/send.ts. A
// failed email must never fail whatever caller-side action (creating a
// substitution request, running the nightly reminder check) triggered it.
export async function sendEmailToRecipients(
  recipients: EmailRecipient[],
  payload: EmailPayload,
): Promise<void> {
  const uniqueByEmail = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));
  const unique = [...uniqueByEmail.values()];

  if (unique.length === 0) {
    return;
  }

  const apiKey = getEnv("RESEND_API_KEY");

  for (const batch of chunk(unique, BATCH_LIMIT)) {
    try {
      const response = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          batch.map((recipient) => ({
            from: payload.from ?? FROM_ADDRESS,
            to: [recipient.email],
            subject: payload.subject,
            html: payload.html,
          })),
        ),
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        console.error(`[email] Resend batch send failed: ${response.status} ${response.statusText} -- ${bodyText}`);
      }
    } catch (sendError) {
      console.error("[email] Send failed:", sendError instanceof Error ? sendError.message : sendError);
    }
  }
}
