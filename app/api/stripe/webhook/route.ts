import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { provisionCheckout } from "@/lib/billing/signup";
import { getStripe } from "@/lib/billing/stripe";
import { syncSubscriptionStatus } from "@/lib/billing/subscriptions";
import { getEnv, getOptionalEnv } from "@/lib/env";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Stripe events for SynqIQ's own billing, verified with the webhook signing
// secret:
//   checkout.session.completed      create the studio (if the success page hasn't)
//   customer.subscription.updated   mirror past_due / active / canceled
//   customer.subscription.deleted
export async function POST(request: NextRequest) {
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      request.headers.get("stripe-signature") ?? "",
      getEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return new NextResponse("invalid signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
      await provisionCheckout(event.data.object.id, `${origin}/auth/confirm`);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await syncSubscriptionStatus(event.data.object);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe/webhook]", event.type, error);
    // 500 so Stripe retries.
    return new NextResponse("error", { status: 500 });
  }
}
