import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findStudio, memberPortalAllowed, sameOrigin, startSession } from "@/lib/member/session";
import { LOCK_MINUTES, afterFailedAttempt, normalizeEmail, verifyPassword } from "@/lib/member/password";

const WRONG = "That email and password don't match.";

// Member sign-in with email + password. Five wrong passwords in a row lock
// the account for 15 minutes.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { studio?: unknown; email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!email || !password) return NextResponse.json({ success: false, error: "Enter your email and password." }, { status: 400 });
  const studio = await findStudio(Number(body?.studio));
  if (!studio) return NextResponse.json({ success: false, error: "Studio not found." }, { status: 404 });

  const admin = createSupabaseAdminClient();
  const { data: account } = await admin
    .from("member_accounts")
    .select("id, mindbody_client_id, password_hash, failed_attempts, locked_until")
    .eq("organization_id", studio.id)
    .eq("email", email)
    .maybeSingle();
  if (account?.locked_until && Date.parse(account.locked_until as string) > Date.now()) {
    return NextResponse.json(
      { success: false, error: `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes, or reset your password.` },
      { status: 429 },
    );
  }
  const valid = await verifyPassword(password, (account?.password_hash as string | null) ?? null);
  if (!account || !valid) {
    if (account) {
      const next = afterFailedAttempt(Number(account.failed_attempts ?? 0), new Date());
      await admin
        .from("member_accounts")
        .update({ failed_attempts: next.failedAttempts, locked_until: next.lockedUntil })
        .eq("id", account.id);
    }
    return NextResponse.json({ success: false, error: WRONG }, { status: 401 });
  }
  if (!(await memberPortalAllowed(studio, account.mindbody_client_id as string))) {
    return NextResponse.json({ success: false, error: "Online booking isn't open for your account yet." }, { status: 403 });
  }
  await admin
    .from("member_accounts")
    .update({ failed_attempts: 0, locked_until: null, last_sign_in_at: new Date().toISOString() })
    .eq("id", account.id);
  const response = NextResponse.json({ success: true });
  await startSession(account.id as string, request, response);
  return response;
}
