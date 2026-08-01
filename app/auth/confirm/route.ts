import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Landing point for Supabase Auth email links -- currently only password
// recovery uses this, but it's written to key off `type` the way Supabase's
// own docs recommend, so a future email-change/signup-confirmation flow can
// reuse it. Deliberately no free-form `next` query param: the destination
// per type is hardcoded below, not read from the URL, so there's no
// open-redirect surface here.
//
// Uses verifyOtp(token_hash) rather than exchangeCodeForSession(code) --
// the default PKCE code-exchange flow requires a code_verifier stored on
// the device that *requested* the reset, which isn't there if the email is
// opened on a different device. token_hash has no such requirement. This
// only works if the Reset Password email template is pointed at
// {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery -- a
// Supabase-dashboard-only change, not something this route controls.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=reset-link-invalid", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=reset-link-invalid", request.url));
  }

  if (type === "recovery") {
    return NextResponse.redirect(new URL("/reset-password", request.url));
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
