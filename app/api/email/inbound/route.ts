import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifyResendWebhook } from "@/lib/followup/verify-webhook";
import { fetchReceivedEmail } from "@/lib/email/resend-inbound";
import { handleInboundEmail } from "@/lib/followup/inbound";

// crypto (webhook verification) + the Receiving API fetch + several
// sequential Supabase round trips + a Resend send per inbound mail.
export const runtime = "nodejs";
export const maxDuration = 60;

// Resend's `email.received` webhook is METADATA ONLY -- it carries the
// email_id plus sender/recipient/subject, NOT the body or headers. We
// verify the signature, pull the email_id, then fetch the full content
// from the Receiving API before doing anything with it.
export async function POST(request: NextRequest) {
  // Raw body -- the signature is computed over the exact bytes.
  const body = await request.text();

  const verification = verifyResendWebhook({
    secret: getEnv("RESEND_INBOUND_WEBHOOK_SECRET"),
    headers: {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    body,
  });

  if (!verification.ok) {
    console.warn(`[followup] inbound webhook rejected: ${verification.reason}`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseWebhook(payload);
  if (!parsed) {
    // Not an inbound-email event (a delivery/bounce notification on the
    // same endpoint, or an unrecognised shape). 200 so Resend doesn't retry.
    console.warn(`[followup] inbound webhook: not an email.received event (${describeShape(payload)})`);
    return NextResponse.json({ status: "ignored" });
  }

  const received = await fetchReceivedEmail(parsed.emailId);
  if (!received) {
    // The fetch layer already logged why. 500 so Resend retries -- a
    // transient Receiving API failure shouldn't lose the message.
    return NextResponse.json({ error: "could not fetch email content" }, { status: 500 });
  }

  const result = await handleInboundEmail({
    from: received.from,
    to: received.to,
    subject: received.subject,
    text: received.text,
    messageId: received.messageId,
  });

  if (result.status === "dropped") {
    console.warn(`[followup] inbound dropped: ${result.reason}`);
  }
  return NextResponse.json(result);
}

type ParsedWebhook = { emailId: string };

function parseWebhook(payload: unknown): ParsedWebhook | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const type = typeof root.type === "string" ? root.type : "";
  if (type && !/received|inbound/i.test(type)) {
    return null;
  }

  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const emailId =
    typeof data.email_id === "string"
      ? data.email_id
      : typeof data.id === "string"
        ? data.id
        : null;

  return emailId ? { emailId } : null;
}

function describeShape(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return typeof payload;
  }
  const root = payload as Record<string, unknown>;
  const keys = Object.keys(root);
  if (typeof root.type === "string") {
    keys.push(`type=${root.type}`);
  }
  if (root.data && typeof root.data === "object") {
    keys.push(`data:{${Object.keys(root.data as Record<string, unknown>).join(",")}}`);
  }
  return keys.join(",");
}
