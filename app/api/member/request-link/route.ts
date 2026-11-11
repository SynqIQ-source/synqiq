import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findStudio, memberPortalAllowed, sameOrigin } from "@/lib/member/session";
import { looksLikeEmail, newToken, normalizeEmail } from "@/lib/member/password";
import { sendEmailToRecipients } from "@/lib/email/send";
import { memberPasswordLinkEmail } from "@/lib/email/templates";
import { resolveRequestOrigin } from "@/lib/request-origin";

const GENERIC = "If that email belongs to a member here, we've sent a link. Check your inbox (and spam).";
const LINK_MINUTES = 60;

// Create-account and forgot-password both land here: email -> one-time
// link to set a password. The answer is the same whether or not the email
// matched, so it can't be used to find out who's a member. During the
// parallel run only testers a Club Admin added get an email.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { studio?: unknown; email?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (!looksLikeEmail(email)) return NextResponse.json({ success: false, error: "Enter your email address." }, { status: 400 });
  const studio = await findStudio(Number(body?.studio));
  if (!studio) return NextResponse.json({ success: false, error: "Studio not found." }, { status: 404 });
  const ok = NextResponse.json({ success: true, message: GENERIC });
  if (studio.mode === "off") return ok;

  const admin = createSupabaseAdminClient();
  const escaped = email.replace(/[\\%_]/g, (character) => `\\${character}`);
  const { data: matches } = await admin
    .from("clients")
    .select("mindbody_client_id, first_name, email")
    .eq("organization_id", studio.id)
    .ilike("email", escaped)
    .limit(3);
  // One client per email; shared family emails go through the front desk.
  if (!matches || matches.length !== 1) return ok;
  const client = matches[0];
  const clientId = client.mindbody_client_id as string;
  if (!clientId || !(await memberPortalAllowed(studio, clientId))) return ok;

  // The account (one per client); its email follows the client's.
  let { data: account } = await admin
    .from("member_accounts")
    .select("id, password_hash")
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", clientId)
    .maybeSingle();
  if (!account) {
    const { data: created, error } = await admin
      .from("member_accounts")
      .insert({ organization_id: studio.id, mindbody_client_id: clientId, email })
      .select("id, password_hash")
      .single();
    if (error) {
      console.error("[member] account create failed:", error.message);
      return ok;
    }
    account = created;
  } else {
    await admin.from("member_accounts").update({ email }).eq("id", account.id);
  }

  // At most one email a minute per account.
  const { data: recent } = await admin
    .from("member_tokens")
    .select("created_at")
    .eq("account_id", account.id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString())
    .limit(1);
  if (recent?.length) return ok;

  const { token, hash } = newToken();
  const { error: tokenError } = await admin
    .from("member_tokens")
    .insert({ account_id: account.id, token_hash: hash, expires_at: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() });
  if (tokenError) {
    console.error("[member] token failed:", tokenError.message);
    return ok;
  }
  const link = `${resolveRequestOrigin(request)}/m/${studio.siteId}/set-password?token=${encodeURIComponent(token)}`;
  const message = memberPasswordLinkEmail({
    studioName: studio.name,
    firstName: ((client.first_name as string | null) ?? "").trim() || "there",
    link,
    isNew: !account.password_hash,
  });
  await sendEmailToRecipients([{ email }], { ...message, from: `${studio.name.replace(/[<>"]/g, "")} <notifications@synqiq.co>` });
  return ok;
}
