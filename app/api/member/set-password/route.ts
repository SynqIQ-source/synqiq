import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findStudio, memberPortalAllowed, sameOrigin, startSession } from "@/lib/member/session";
import { hashPassword, hashToken, passwordProblem } from "@/lib/member/password";

// The emailed link: set a password, sign out everywhere else, sign in here.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!token || token.length > 200) return NextResponse.json({ success: false, error: "This link isn't valid." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("member_tokens")
    .select(
      "id, expires_at, used_at, account:member_accounts!inner ( id, email, mindbody_client_id, organization:organizations!inner ( mindbody_site_id ) )",
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle<{
      id: string;
      expires_at: string;
      used_at: string | null;
      account: { id: string; email: string; mindbody_client_id: string; organization: { mindbody_site_id: number } };
    }>();
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    return NextResponse.json({ success: false, error: "This link has expired or was already used. Ask for a new one." }, { status: 400 });
  }
  const problem = passwordProblem(password, row.account.email);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
  const studio = await findStudio(Number(row.account.organization.mindbody_site_id));
  if (!studio || !(await memberPortalAllowed(studio, row.account.mindbody_client_id))) {
    return NextResponse.json({ success: false, error: "Online booking isn't open for your account yet." }, { status: 403 });
  }

  // Use the link once (only if nobody used it in the meantime).
  const { data: claimed } = await admin
    .from("member_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (!claimed?.length) return NextResponse.json({ success: false, error: "This link was already used." }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await admin
    .from("member_accounts")
    .update({
      password_hash: await hashPassword(password),
      password_set_at: now,
      failed_attempts: 0,
      locked_until: null,
      last_sign_in_at: now,
    })
    .eq("id", row.account.id);
  if (error) {
    console.error("[member] set password failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  await admin.from("member_sessions").delete().eq("account_id", row.account.id);
  const response = NextResponse.json({ success: true, studio: studio.siteId });
  await startSession(row.account.id, request, response);
  return response;
}
