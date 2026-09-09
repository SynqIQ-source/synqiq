import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifyResendWebhook } from "@/lib/followup/verify-webhook";
import { handleInboundEmail, type InboundEmail } from "@/lib/followup/inbound";

// crypto (webhook verification) + several sequential Supabase round trips
// and a Resend send per inbound mail.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Raw body -- the signature is computed over the exact bytes, so this
  // must be read before any JSON parsing.
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

  const email = parseInboundEmail(payload);
  if (!email) {
    // Structurally not an inbound email we can act on (a delivery/bounce
    // event on the same endpoint, or a shape we don't recognise). 200 so
    // Resend doesn't retry it.
    console.warn(
      `[followup] inbound webhook: no actionable email in payload (keys: ${describeShape(payload)})`,
    );
    return NextResponse.json({ status: "ignored" });
  }

  const result = await handleInboundEmail(email);
  if (result.status === "dropped") {
    console.warn(`[followup] inbound dropped: ${result.reason}`);
  }
  return NextResponse.json(result);
}

// Resend's inbound payload shape is still settling and isn't pinned in a
// versioned SDK type, so parse defensively: accept string-or-object
// addresses, array-or-map headers, and both top-level and data-nested
// fields. If Resend firms this up, tighten here.
function parseInboundEmail(payload: unknown): InboundEmail | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const type = typeof root.type === "string" ? root.type : "";
  if (type && !/received|inbound/i.test(type)) {
    return null;
  }

  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;

  const from = firstAddress(data.from);
  const to = addressList(data.to);
  const subject = typeof data.subject === "string" ? data.subject : "";
  const text = pickText(data);
  const messageId = headerValue(data.headers, "message-id");

  if (!from || to.length === 0 || !text) {
    return null;
  }

  return { from, to, subject, text, messageId };
}

function firstAddress(value: unknown): string | null {
  const list = addressList(value);
  return list[0] ?? null;
}

function addressList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map(addressString).filter((entry): entry is string => Boolean(entry));
  }
  const single = addressString(value);
  return single ? [single] : [];
}

function addressString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const address = typeof obj.address === "string" ? obj.address : typeof obj.email === "string" ? obj.email : null;
    if (!address) {
      return null;
    }
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : null;
    return name ? `${name} <${address}>` : address;
  }
  return null;
}

function pickText(data: Record<string, unknown>): string {
  if (typeof data.text === "string" && data.text.trim()) {
    return data.text;
  }
  // Last resort: strip tags off the HTML part so a text-less mail still relays.
  if (typeof data.html === "string" && data.html.trim()) {
    return data.html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return "";
}

function headerValue(headers: unknown, name: string): string | null {
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        if (typeof obj.name === "string" && obj.name.toLowerCase() === target && typeof obj.value === "string") {
          return obj.value;
        }
      }
    }
    return null;
  }
  if (headers && typeof headers === "object") {
    for (const [key, val] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === target && typeof val === "string") {
        return val;
      }
    }
  }
  return null;
}

function describeShape(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return typeof payload;
  }
  const root = payload as Record<string, unknown>;
  const keys = Object.keys(root);
  if (root.data && typeof root.data === "object") {
    keys.push(`data:{${Object.keys(root.data as Record<string, unknown>).join(",")}}`);
  }
  return keys.join(",");
}
