"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "submitting" | "error";

const LINK_ERROR_MESSAGES: Record<string, string> = {
  "reset-link-invalid": "That password reset link is invalid or has expired. Request a new one below.",
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    // The browser client (createBrowserClient from @supabase/ssr) writes the
    // session to cookies itself -- router.refresh() re-runs Server
    // Components so they pick up the now-present session immediately.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-zinc-950">Sign in to your account</h1>

      {linkError && LINK_ERROR_MESSAGES[linkError] ? (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {LINK_ERROR_MESSAGES[linkError]}
        </p>
      ) : null}

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

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-700" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
          />
        </div>

        {status === "error" ? (
          <p className="text-sm text-red-600">{errorMessage}</p>
        ) : null}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {status === "submitting" ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
