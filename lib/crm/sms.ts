import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio SMS over its REST API (no SDK). Needs TWILIO_ACCOUNT_SID and
// TWILIO_AUTH_TOKEN; texts are sent from the org's organizations.crm_sms_number
// (or TWILIO_MESSAGING_SERVICE_SID when set, which Twilio prefers for A2P
// 10DLC campaigns). Until those are set, sending reports "not set up".

export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export type SmsSendResult = { ok: true; sid: string; status: string } | { ok: false; error: string; code?: number };

export async function sendSms(params: { to: string; from: string | null; body: string; statusCallback?: string }): Promise<SmsSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token) return { ok: false, error: "Texting isn't set up yet (Twilio keys missing)." };
  if (!service && !params.from) return { ok: false, error: "Texting isn't set up yet (no studio number)." };

  const form = new URLSearchParams({ To: params.to, Body: params.body });
  if (service) form.set("MessagingServiceSid", service);
  else form.set("From", params.from!);
  if (params.statusCallback) form.set("StatusCallback", params.statusCallback);

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof data.code === "number" ? data.code : undefined;
      // 21610: the recipient texted STOP to this number.
      const error =
        code === 21610
          ? "This guest has opted out of texts (they replied STOP)."
          : `Twilio error ${code ?? response.status}`;
      return { ok: false, error, code };
    }
    return { ok: true, sid: String(data.sid), status: String(data.status ?? "queued") };
  } catch {
    return { ok: false, error: "Couldn't reach Twilio. Try again." };
  }
}

// Twilio signs webhooks: base64(HMAC-SHA1(authToken, url + sorted params)).
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const keys = [...new Set(params.keys())].sort();
  const data = url + keys.map((key) => key + params.getAll(key).join("")).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const OPT_OUT = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const OPT_IN = new Set(["start", "unstop", "yes"]);

export function optKeyword(body: string): "out" | "in" | null {
  const word = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (OPT_OUT.has(word)) return "out";
  if (OPT_IN.has(word)) return "in";
  return null;
}

// Texts only go out 8 AM-9 PM in the studio's time zone (TCPA quiet hours).
export function withinTextingHours(timezone: string, now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  return hour >= 8 && hour < 21;
}
