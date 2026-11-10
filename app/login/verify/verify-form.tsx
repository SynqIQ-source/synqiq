"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Enter the 6-digit code from the authenticator app. Uses the account's
// verified authenticator (there is one per account in SynqIQ).
export function VerifyForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((candidate) => candidate.status === "verified");
    if (listError || !factor) {
      setBusy(false);
      setError("Your session ended. Sign in again.");
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code.replace(/\s+/g, ""),
    });
    if (verifyError) {
      setBusy(false);
      setError("That code didn't work. Check the time on your phone and try the newest code.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-zinc-950">Enter your code</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Open your authenticator app and enter the 6-digit code for SynqIQ.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-zinc-700" htmlFor="code">
          Code
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          autoFocus
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-center text-lg tracking-widest text-zinc-950"
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || code.replace(/\s+/g, "").length !== 6}
          className="w-full rounded-md bg-brand-accent px-3 py-2 text-sm font-medium text-white hover:bg-brand-accent-hover disabled:opacity-60"
        >
          {busy ? "Checking..." : "Continue"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600">
        Lost your phone? Ask a Club Admin to reset your two-step sign-in.{" "}
        <button type="button" onClick={() => void signOut()} className="font-medium text-primary hover:underline">
          Sign out
        </button>
      </p>
    </div>
  );
}
