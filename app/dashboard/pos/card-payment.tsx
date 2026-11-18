"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

export type CardSession = {
  paymentId: string;
  clientSecret: string;
  publishableKey: string;
  stripeAccountId: string;
  amountCents: number;
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Stripe's Payment Element, loaded for the studio's own Stripe account (the
// server chose the account and created the payment). Card details go
// straight to Stripe; SynqIQ only learns whether the payment succeeded, and
// the server re-checks that with Stripe before saving the sale.
export function CardPayment({ session, onPaid, onCancel }: { session: CardSession; onPaid: () => Promise<void>; onCancel: () => void }) {
  const stripePromise = useMemo(
    () => loadStripe(session.publishableKey, { stripeAccount: session.stripeAccountId }),
    [session.publishableKey, session.stripeAccountId],
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <h2 className="text-lg font-semibold">Charge {money(session.amountCents)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter the card, or let the member type it in.</p>
        <div className="mt-4">
          <Elements stripe={stripePromise} options={{ clientSecret: session.clientSecret, appearance: { theme: "stripe" } }}>
            <CardForm amountCents={session.amountCents} onPaid={onPaid} onCancel={onCancel} />
          </Elements>
        </div>
      </div>
    </div>
  );
}

function CardForm({ amountCents, onPaid, onCancel }: { amountCents: number; onPaid: () => Promise<void>; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charged, setCharged] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (stripeError) {
      setBusy(false);
      return setError(stripeError.message ?? "The card was declined.");
    }
    if (paymentIntent && paymentIntent.status !== "succeeded" && paymentIntent.status !== "processing") {
      setBusy(false);
      return setError("The card wasn't charged. Try again or use another card.");
    }
    setCharged(true);
    await onPaid();
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!stripe || busy || charged} onClick={pay}>
          {busy ? "Charging…" : `Charge ${money(amountCents)}`}
        </Button>
        <Button variant="outline" disabled={busy || charged} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
