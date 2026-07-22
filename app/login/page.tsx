"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "submitting" | "error";

export default function LoginPage() {
  const router = useRouter();
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-950">Synq</h1>
        <p className="mt-1 text-sm text-zinc-600">Sign in to your account.</p>

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

          <label className="block text-sm font-medium text-zinc-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
            />
          </label>

          {status === "error" ? (
            <p className="text-sm text-red-600">{errorMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {status === "submitting" ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
