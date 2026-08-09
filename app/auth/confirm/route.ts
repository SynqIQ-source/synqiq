import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Landing point for Supabase Auth email links -- used by both password
// recovery and staff-invite links, keyed off `type` the way Supabase's own
// docs recommend, so a future email-change/signup-confirmation flow can
// reuse it too. Deliberately no free-form `next` query param: the
// destination per type is hardcoded below, not read from the URL, so
// there's no open-redirect surface here.
//
// Uses verifyOtp(token_hash) rather than exchangeCodeForSession(code) --
// the default PKCE code-exchange flow requires a code_verifier stored on
// the device that *requested* the link, which isn't there if the email is
// opened on a different device (the normal case for both a password reset
// and a staff invite). token_hash has no such requirement. This only works
// if the relevant Supabase email template (Reset Password, and separately
// Invite User) is pointed at
// {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery (or
// &type=invite) -- a Supabase-dashboard-only change per template, not
// something this route controls.
export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=reset-link-invalid", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=reset-link-invalid", origin));
  }

  // Invite lands on the same "set your password" form as recovery -- a
  // staff member's first-ever password is functionally identical to
  // resetting one, so this reuses that page rather than building a
  // separate first-time-setup flow.
  if (type === "recovery" || type === "invite") {
    return NextResponse.redirect(new URL("/reset-password", origin));
  }

  return NextResponse.redirect(new URL("/dashboard", origin));
}
