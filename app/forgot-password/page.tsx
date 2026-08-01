"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "submitting" | "sent";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const supabase = createSupabaseBrowserClient();
    // redirectTo is computed from the current origin at request time (not a
    // fixed dashboard setting) so this works whether you're on localhost or
    // a tunnel domain -- as long as that origin is in Supabase's Redirect
    // URLs allowlist. The email template itself still has to be pointed at
    // {{ .RedirectTo }} (not the default {{ .SiteURL }}-based link) for this
    // to actually take effect -- see conversation history.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    });

    // Logged but never shown to the user -- the UI stays on the same "sent"
    // state regardless of outcome (same reasoning Supabase's own API
    // follows: don't let this become an email-enumeration signal). This is
    // just so a real failure (bad API key, network issue, rate limit) is
    // visible somewhere instead of silently invisible.
    if (error) {
      console.error("resetPasswordForEmail failed:", error.message);
    }

    setStatus("sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-950">Reset your password</h1>

        {status === "sent" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              If an account exists for that email, a reset link has been sent. Open it on
              whichever device is easiest -- it isn&apos;t tied to the device you&apos;re on now.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-600">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-zinc-700">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
                />
              </label>

              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {status === "submitting" ? "Sending..." : "Send reset link"}
              </button>
            </form>

            <Link
              href="/login"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
