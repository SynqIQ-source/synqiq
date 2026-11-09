import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients } from "@/lib/email/send";
import { newLeadEmail, leadAutoResponseEmail } from "@/lib/email/templates";
import { getOptionalEnv } from "@/lib/env";
import { createHash } from "node:crypto";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { clientIp } from "@/lib/crm/kiosk-auth";

// Abuse limits for this public form (it emails whatever address is typed in,
// so it must not become a way to send SynqIQ mail to strangers).
const PER_VISITOR = [
  { windowSeconds: 3_600, limit: 5 },
  { windowSeconds: 86_400, limit: 20 },
];
// Auto-replies: at most one per email address per day, and a site-wide daily
// cap so a spread-out attack can't send much mail either.
const AUTO_REPLY_PER_ADDRESS_PER_DAY = 1;
const AUTO_REPLIES_PER_DAY = 50;

const hashKey = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_LENGTH = 200;

// Public, unauthenticated -- this is the /contact marketing page's lead
// form, submitted by visitors who have no SynqIQ account at all. Protected
// by a hidden bot-trap field and per-visitor / auto-reply rate limits. Not gated
// by middleware.ts (that only covers /dashboard/*). Re-validates
// server-side rather than trusting the client form's own checks, same as
// every other public-facing write in this app.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Hidden "company website" field on the form (lead-form.tsx): people never
    // see it, scripts fill it in. Answer like a success so bots learn nothing,
    // but save and send nothing.
    if (typeof body?.companyWebsite === "string" && body.companyWebsite.trim() !== "") {
      return NextResponse.json({ success: true });
    }

    const visitorKey = hashKey(clientIp(request.headers) ?? "unknown");
    const allowed = await rateLimitAll(
      PER_VISITOR.map((window) => ({
        key: `leads:visitor:${window.windowSeconds}:${visitorKey}`,
        windowSeconds: window.windowSeconds,
        limit: window.limit,
      })),
    );
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later, or email info@synqiq.co." },
        { status: 429 },
      );
    }

    const name: unknown = body?.name;
    const studioName: unknown = body?.studioName;
    const website: unknown = body?.website;
    const phone: unknown = body?.phone;
    const email: unknown = body?.email;

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    if (name.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: `Name must be ${MAX_FIELD_LENGTH} characters or fewer.` }, { status: 400 });
    }

    if (typeof studioName !== "string" || !studioName.trim()) {
      return NextResponse.json({ error: "Studio / Gym Name is required." }, { status: 400 });
    }
    if (studioName.length > MAX_FIELD_LENGTH) {
      return NextResponse.json(
        { error: `Studio / Gym Name must be ${MAX_FIELD_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }

    if (typeof email !== "string" || !email.trim() || !EMAIL_PATTERN.test(email.trim())) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
    }

    if (website !== null && website !== undefined && typeof website !== "string") {
      return NextResponse.json({ error: "Website must be a string." }, { status: 400 });
    }
    if (typeof website === "string" && website.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: `Website must be ${MAX_FIELD_LENGTH} characters or fewer.` }, { status: 400 });
    }

    if (phone !== null && phone !== undefined && typeof phone !== "string") {
      return NextResponse.json({ error: "Phone must be a string." }, { status: 400 });
    }
    if (typeof phone === "string" && phone.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: `Phone must be ${MAX_FIELD_LENGTH} characters or fewer.` }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const trimmedWebsite = typeof website === "string" && website.trim() ? website.trim() : null;
    const trimmedPhone = typeof phone === "string" && phone.trim() ? phone.trim() : null;

    const { error } = await admin.from("leads").insert({
      name: name.trim(),
      studio_name: studioName.trim(),
      website: trimmedWebsite,
      phone: trimmedPhone,
      email: email.trim(),
    });

    if (error) {
      throw new Error(error.message);
    }

    // Best-effort, never fails the request -- the lead is already saved by
    // this point, same non-blocking convention as every other notification
    // send in this app (lib/push/send.ts, the substitution-request emails).
    const notifyEmail = getOptionalEnv("LEAD_NOTIFICATION_EMAIL");
    if (notifyEmail) {
      try {
        const { subject, html } = newLeadEmail({
          name: name.trim(),
          studioName: studioName.trim(),
          website: trimmedWebsite,
          phone: trimmedPhone,
          email: email.trim(),
        });
        await sendEmailToRecipients([{ email: notifyEmail }], { subject, html });
      } catch (notifyError) {
        console.error(
          "[leads] Failed to send new-lead notification email:",
          notifyError instanceof Error ? notifyError.message : notifyError,
        );
      }
    }

    // Also best-effort -- the internal notification above and this one are
    // independent sends, so a failure in one must never block the other.
    // Rate-limited: one per address per day, plus a site-wide daily cap.
    try {
      const mayReply = await rateLimitAll([
        {
          key: `leads:reply-to:${hashKey(email.trim().toLowerCase())}`,
          windowSeconds: 86_400,
          limit: AUTO_REPLY_PER_ADDRESS_PER_DAY,
        },
        { key: "leads:replies-all", windowSeconds: 86_400, limit: AUTO_REPLIES_PER_DAY },
      ]);
      if (!mayReply) throw new Error("auto-reply limit reached; lead saved, no reply sent");
      const { subject, html } = leadAutoResponseEmail({ name: name.trim(), studioName: studioName.trim() });
      await sendEmailToRecipients(
        [{ email: email.trim() }],
        { subject, html, from: "SynqIQ Support <noreply@synqiq.co>" },
      );
    } catch (autoResponseError) {
      console.error(
        "[leads] Failed to send lead auto-response email:",
        autoResponseError instanceof Error ? autoResponseError.message : autoResponseError,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
