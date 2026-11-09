import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { provisionCheckout } from "@/lib/billing/signup";
import { getStripe } from "@/lib/billing/stripe";
import { syncSubscriptionStatus } from "@/lib/billing/subscriptions";
import { getEnv, getOptionalEnv } from "@/lib/env";
import { resolveRequestOrigin } from "@/lib/request-origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  // At-least-once delivery: record the event id first and skip repeats. If
  // handling fails, the record is removed so Stripe's retry runs it again.
  const admin = createSupabaseAdminClient();
  const { data: claimed, error: claimError } = await admin
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (claimError) {
    console.error("[stripe/webhook] could not record event", event.id, claimError.message);
    return new NextResponse("error", { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ received: true, duplicate: true });
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
    console.error("[stripe/webhook]", event.type, event.id, error instanceof Error ? error.message : error);
    await admin.from("stripe_events").delete().eq("id", event.id);
    // 500 so Stripe retries.
    return new NextResponse("error", { status: 500 });
  }
}
