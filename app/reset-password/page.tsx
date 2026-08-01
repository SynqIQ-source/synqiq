import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Deliberately checks for a raw Supabase session, not getCurrentStaff() --
// this page's concern is "is there a session to act on" (established by
// app/auth/confirm/route.ts's verifyOtp call), not "is this a provisioned
// staff member." Someone landing here cold (no session at all -- e.g. a
// stale bookmark, or the link already got used) sees a clear message
// instead of a form that would just fail on submit.
export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-950">Set a new password</h1>

        {user ? (
          <>
            <p className="mt-1 text-sm text-zinc-600">Choose a new password for your account.</p>
            <ResetPasswordForm />
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              This link is invalid or has expired.
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Request a new reset link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
