"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Enrollment = { factorId: string; qrCode: string; secret: string };

// Two-step sign-in with an authenticator app (Google Authenticator, 1Password,
// Authy...). Set up here: scan the QR code, then confirm with a code. After
// that, every sign-in asks for a code (app/login/verify). Recommended for
// everyone; asked of Club Admins (lib/auth/mfa-policy.ts).
export function TwoStepSection({ isClubAdmin }: { isClubAdmin: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await createSupabaseBrowserClient().auth.mfa.listFactors();
    setEnabled(Boolean(data?.totp.some((factor) => factor.status === "verified")));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function start() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    // Clear any half-finished setup first, or Supabase refuses a new one.
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const factor of existing?.all ?? []) {
      if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `SynqIQ ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (enrollError || !data) {
      setError("Couldn't start setup. Try again.");
      return;
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code: code.replace(/\s+/g, ""),
    });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't work. Enter the newest code from the app.");
      return;
    }
    setEnrollment(null);
    setCode("");
    await refresh();
    router.refresh();
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.mfa.listFactors();
    for (const factor of data?.all ?? []) {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) {
        setBusy(false);
        setError("Couldn't turn it off. Sign out, sign back in with your code, and try again.");
        return;
      }
    }
    setBusy(false);
    setConfirmingOff(false);
    await refresh();
    router.refresh();
  }

  return (
    <section id="two-step" className="max-w-xl rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">Two-step sign-in</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        After your password, enter a 6-digit code from an authenticator app on your phone (Google Authenticator,
        Microsoft Authenticator, 1Password or Authy).
        {isClubAdmin ? " Club Admins should turn this on; it will be required before member payments go live." : ""}
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Checking…</p>
      ) : enabled ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-sm font-medium text-emerald-700">On. You&apos;ll be asked for a code each time you sign in.</p>
          {isClubAdmin ? null : confirmingOff ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Turn off two-step sign-in?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void turnOff()}
                className="font-medium text-red-600 hover:underline disabled:opacity-60"
              >
                Turn off
              </button>
              <button type="button" onClick={() => setConfirmingOff(false)} className="text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingOff(true)}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Turn off
            </button>
          )}
        </div>
      ) : enrollment ? (
        <form onSubmit={confirm} className="mt-4 flex flex-col gap-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this QR code (or type the key below).</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="w-fit rounded-lg border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={180} height={180} />
          </div>
          <p className="text-xs text-muted-foreground">
            Key: <span className="select-all font-mono text-foreground">{enrollment.secret}</span>
          </p>
          <label htmlFor="two-step-code" className="text-sm font-medium text-foreground">
            Code from the app
          </label>
          <input
            id="two-step-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="w-40 rounded-md border border-border px-3 py-2 text-center text-lg tracking-widest text-foreground"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || code.replace(/\s+/g, "").length !== 6}
              className="rounded-md bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent-hover disabled:opacity-60"
            >
              {busy ? "Checking..." : "Turn on"}
            </button>
            <button
              type="button"
              onClick={() => setEnrollment(null)}
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void start()}
          className="mt-4 rounded-md bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent-hover disabled:opacity-60"
        >
          {busy ? "Starting..." : "Set up two-step sign-in"}
        </button>
      )}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
