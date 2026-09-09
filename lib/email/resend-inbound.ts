import { getEnv } from "@/lib/env";

// Resend's `email.received` webhook carries METADATA ONLY -- email_id,
// from, to, cc, bcc, subject, attachment list. The body and headers are
// NOT in the webhook payload; they have to be pulled with a second call to
// the Receiving API (GET /emails/receiving/{id}). Confirmed against
// Resend's own SDK/skills docs (2026-09).
const RESEND_RECEIVING_URL = "https://api.resend.com/emails/receiving";

// Shape of GET /emails/receiving/{id} (the fields this relay uses -- the
// response also carries object/id/created_at/cc/bcc/reply_to/received_for/
// raw/attachments).
export type ReceivedEmail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  // The received mail's own RFC Message-ID, returned as a first-class
  // field -- no header parsing needed.
  messageId: string | null;
  headers: Record<string, string> | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const apiKey = getEnv("RESEND_API_KEY");

  let response: Response;
  try {
    response = await fetch(`${RESEND_RECEIVING_URL}/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch (fetchError) {
    console.error(
      `[followup] receiving API fetch failed for ${emailId}:`,
      fetchError instanceof Error ? fetchError.message : fetchError,
    );
    return null;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(
      `[followup] receiving API ${response.status} ${response.statusText} for ${emailId} -- ${bodyText}`,
    );
    return null;
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) {
    return null;
  }

  const from = typeof data.from === "string" ? data.from : "";
  const to = Array.isArray(data.to) ? data.to.filter((entry): entry is string => typeof entry === "string") : [];
  const subject = typeof data.subject === "string" ? data.subject : "";
  const text =
    typeof data.text === "string" && data.text.trim()
      ? data.text
      : typeof data.html === "string"
        ? stripHtml(data.html)
        : "";
  const messageId =
    typeof data.message_id === "string" && data.message_id
      ? data.message_id
      : headerValue(data.headers, "message-id");
  const headers =
    data.headers && typeof data.headers === "object"
      ? (data.headers as Record<string, string>)
      : null;

  if (!from || to.length === 0) {
    console.error(`[followup] receiving API payload for ${emailId} missing from/to (keys: ${Object.keys(data).join(",")})`);
    return null;
  }

  return { from, to, subject, text, messageId, headers };
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") {
    return null;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === target && typeof value === "string") {
      return value;
    }
  }
  return null;
}
