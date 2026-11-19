"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

// Update the card on file (lib/billing/cards.ts) with Stripe's Payment
// Element: the card number (or an Apple Pay / Google Pay card) goes from this
// page straight to Stripe and is saved on the studio's Stripe account; SynqIQ
// only gets back which card it was. Used at the desk, on the emailed link and
// in the member app; `endpoint` + `body` say which.

type Setup = { clientSecret: string; publishableKey: string; stripeAccountId: string };
type Saved = {
  card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };
  retried: string[];
};

export function CardUpdate({
  endpoint,
  body,
  label = "Update card",
  onSaved,
}: {
  endpoint: string;
  body: Record<string, unknown>;
  label?: string;
  onSaved?: (saved: Saved) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function call(payload: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...payload }),
    });
    return (await response.json().catch(() => null)) as ({ success: boolean; error?: string } & Partial<Setup> & Partial<Saved>) | null;
  }

  async function start() {
    setBusy(true);
    setError(null);
    setDone(null);
    const result = await call({ action: "start" });
    setBusy(false);
    if (!result?.success || !result.clientSecret) return setError(result?.error ?? "Couldn't open the card form.");
    setSetup({ clientSecret: result.clientSecret, publishableKey: result.publishableKey!, stripeAccountId: result.stripeAccountId! });
  }

  async function finished(setupIntentId: string) {
    const result = await call({ action: "finish", setupIntentId });
    if (!result?.success || !result.card) return setError(result?.error ?? "The card wasn't saved.");
    setSetup(null);
    const brand = result.card.brand ? result.card.brand[0].toUpperCase() + result.card.brand.slice(1) : "Card";
    const retried = result.retried ?? [];
    setDone(
      `${brand} ending ${result.card.last4} saved.` +
        (retried.length
          ? retried.every((outcome) => outcome === "paid")
            ? " The overdue payment went through."
            : " The overdue payment was tried again and didn't go through."
          : ""),
    );
    onSaved?.(result as Saved);
  }

  if (setup) return <SetupForm setup={setup} onSaved={finished} onCancel={() => setSetup(null)} error={error} setError={setError} />;
  return (
    <div className="space-y-2">
      <Button onClick={start} disabled={busy}>
        {busy ? "Opening…" : label}
      </Button>
      {done ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function SetupForm(props: {
  setup: Setup;
  onSaved: (setupIntentId: string) => Promise<void>;
  onCancel: () => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const stripePromise = useMemo(
    () => loadStripe(props.setup.publishableKey, { stripeAccount: props.setup.stripeAccountId }),
    [props.setup.publishableKey, props.setup.stripeAccountId],
  );
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Elements stripe={stripePromise} options={{ clientSecret: props.setup.clientSecret, appearance: { theme: "stripe" } }}>
        <Inner {...props} />
      </Elements>
    </div>
  );
}

function Inner({ onSaved, onCancel, error, setError }: Parameters<typeof SetupForm>[0]) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: stripeError, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (stripeError || !setupIntent) {
      setBusy(false);
      return setError(stripeError?.message ?? "The card wasn't saved.");
    }
    await onSaved(setupIntent.id);
    setBusy(false);
  }

  return (
    <>
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }} />
      <p className="text-xs text-muted-foreground">
        Saved securely with Stripe for monthly membership payments. Apple Pay or Google Pay fill it in without typing.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || !stripe}>
          {busy ? "Saving…" : "Save card"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </>
  );
}
