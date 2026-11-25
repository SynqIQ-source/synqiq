"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";

// "Confirm your payment" (lib/billing/confirm-payment.ts): asks Stripe to run
// the bank's check (a code or a banking-app approval) on the monthly payment
// the bank held, using the card already on file. No card number is typed.

export function PaymentConfirm({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  async function call(payload: Record<string, unknown>) {
    const response = await fetch("/api/payment-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...payload }),
    });
    return (await response.json().catch(() => null)) as {
      success: boolean;
      error?: string;
      paid?: boolean;
      clientSecret?: string;
      paymentMethodId?: string;
      publishableKey?: string;
      stripeAccountId?: string;
    } | null;
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const start = await call({ action: "start" });
      if (!start?.success) return setError(start?.error ?? "Couldn't open the payment.");
      if (start.paid) return setPaid(true);
      const stripe = await loadStripe(start.publishableKey!, { stripeAccount: start.stripeAccountId! });
      if (!stripe) return setError("Couldn't reach our payment processor. Please try again.");
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(start.clientSecret!, {
        payment_method: start.paymentMethodId!,
      });
      if (stripeError || !paymentIntent) return setError(stripeError?.message ?? "The payment wasn't approved.");
      const finish = await call({ action: "finish", paymentIntentId: paymentIntent.id });
      if (!finish?.success) return setError(finish?.error ?? "The payment wasn't recorded. Please contact the front desk.");
      setPaid(true);
    } finally {
      setBusy(false);
    }
  }

  if (paid)
    return (
      <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
        Thank you, your payment went through. Booking is back on.
      </p>
    );
  return (
    <div className="space-y-2">
      <Button onClick={confirm} disabled={busy}>
        {busy ? "Waiting for your bank…" : `Confirm ${amountLabel} payment`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Your bank may show a window asking for a code or an approval in its app. Your card goes through our payment processor, Stripe.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
