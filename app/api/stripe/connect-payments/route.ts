import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { getOptionalEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripeLivemode } from "@/lib/payments/connect";
import { finishCardPayment, noteCardPaymentFailure } from "@/lib/payments/checkout";

// Stripe event destination, "Connected accounts" scope (snapshot events):
// payments made in studios' own accounts (direct charges). Every request's
// signature is checked against the raw body; each event is applied once
// (stripe_connect_events); events may repeat or arrive out of order, so the
// payment is always re-read from Stripe rather than trusted from the event.
export async function POST(request: NextRequest) {
  const secret = getOptionalEnv("STRIPE_CONNECT_PAYMENTS_WEBHOOK_SECRET");
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  // A live endpoint can also receive test events: only act on our own mode.
  if (event.livemode !== stripeLivemode() || !event.account) return NextResponse.json({ received: true, ignored: true });

  const admin = createSupabaseAdminClient();
  const { error: seenError } = await admin
    .from("stripe_connect_events")
    .insert({ id: event.id, type: event.type, stripe_account_id: event.account });
  if (seenError) {
    if (seenError.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }
  const forget = () => admin.from("stripe_connect_events").delete().eq("id", event.id);

  try {
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.synqiq_payment_id;
      if (paymentId) {
        const result = await finishCardPayment(paymentId, null, event.account);
        // Still processing elsewhere / not ready: let Stripe retry later.
        if ("error" in result && !result.paid && result.error !== "Payment not found.") {
          await forget();
          return NextResponse.json({ error: result.error }, { status: 409 });
        }
      }
    } else if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.synqiq_payment_id;
      if (paymentId)
        await noteCardPaymentFailure(
          paymentId,
          event.account,
          intent.last_payment_error?.message ?? event.type.replace("payment_intent.", ""),
        );
    }
    // charge.refunded, disputes and payout failures are recorded (above) for
    // now; handling them is part of the refunds/disputes step.
  } catch (error) {
    console.error("[stripe/connect-payments] failed:", event.type, error);
    await forget();
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
