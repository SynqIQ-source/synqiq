import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// A studio's own billing (Settings -> Billing): its subscription, the
// Stripe billing portal (card, invoices, address), and canceling at the end
// of the paid period or undoing that.

export type StudioBilling =
  | { kind: "manual"; customPrice: number | null }
  | {
      kind: "stripe";
      customerId: string;
      subscriptionId: string;
      status: Stripe.Subscription.Status;
      amount: number | null;
      periodEnd: string | null;
      cancelAt: string | null;
    };

async function loadOrg(organizationId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from("organizations")
    .select("stripe_customer_id, stripe_subscription_id, custom_monthly_price")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  return data;
}

export async function getStudioBilling(organizationId: string): Promise<StudioBilling> {
  const org = await loadOrg(organizationId);
  if (!org.stripe_customer_id || !org.stripe_subscription_id) {
    return { kind: "manual", customPrice: org.custom_monthly_price === null ? null : Number(org.custom_monthly_price) };
  }
  const subscription = await getStripe().subscriptions.retrieve(org.stripe_subscription_id);
  const item = subscription.items.data[0];
  const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
  return {
    kind: "stripe",
    customerId: org.stripe_customer_id,
    subscriptionId: subscription.id,
    status: subscription.status,
    amount: item?.price.unit_amount !== null && item?.price.unit_amount !== undefined ? item.price.unit_amount / 100 : null,
    periodEnd: iso(item?.current_period_end),
    cancelAt: subscription.cancel_at_period_end ? iso(item?.current_period_end) : iso(subscription.cancel_at),
  };
}

// Cancel at the end of the paid period (they keep access until then), or
// undo a pending cancellation.
export async function setCancelAtPeriodEnd(
  organizationId: string,
  cancel: boolean,
  reason?: { feedback?: Stripe.SubscriptionUpdateParams.CancellationDetails.Feedback; comment?: string },
) {
  const org = await loadOrg(organizationId);
  if (!org.stripe_subscription_id) throw new Error("This studio isn't billed in Stripe.");
  await getStripe().subscriptions.update(org.stripe_subscription_id, {
    cancel_at_period_end: cancel,
    ...(cancel ? { cancellation_details: { feedback: reason?.feedback, comment: reason?.comment?.slice(0, 500) } } : {}),
  });
}

// The Stripe billing portal: update the card, see and pay invoices, change
// billing address or tax id, and cancel. Its settings are created once.
async function portalConfiguration(): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 10 });
  const ours = existing.data.find((config) => config.metadata?.synqiq === "studio_billing");
  if (ours) return ours.id;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "SynqIQ billing" },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id", "name"] },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
    },
    metadata: { synqiq: "studio_billing" },
  });
  return created.id;
}

export async function billingPortalUrl(organizationId: string, returnUrl: string): Promise<string> {
  const org = await loadOrg(organizationId);
  if (!org.stripe_customer_id) throw new Error("This studio isn't billed in Stripe.");
  const session = await getStripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    configuration: await portalConfiguration(),
    return_url: returnUrl,
  });
  return session.url;
}
