import { DateTime } from "luxon";
import type Stripe from "stripe";
import { provisionCheckout } from "@/lib/billing/signup";
import { getStripe, planPriceId, SAAS_TAX_CODE } from "@/lib/billing/stripe";
import { TEXT_OVERAGE, TEXTS_INCLUDED, type ModuleKey } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Keeping Stripe and SynqIQ in step after signup.

// A subscription changed in Stripe (payment failed, canceled, recovered):
// mirror its status on the studio. A canceled studio is marked inactive;
// its data is kept.
export async function syncSubscriptionStatus(subscription: Stripe.Subscription) {
  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = { billing_status: subscription.status };
  if (subscription.status === "canceled") update.status = "inactive";
  else if (subscription.status === "active" || subscription.status === "trialing") update.status = "active";
  await admin.from("organizations").update(update).eq("stripe_subscription_id", subscription.id);
}

// A studio's modules changed on the Studios page: move its subscription to
// the price for the new plan (prorated). Studios with a custom price or no
// Stripe subscription (billed by hand) are left alone.
export async function updateSubscriptionPlan(organizationId: string, modules: ModuleKey[]): Promise<"updated" | "skipped"> {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_subscription_id, custom_monthly_price")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org?.stripe_subscription_id || org.custom_monthly_price !== null || modules.length === 0) return "skipped";
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const item = subscription.items.data[0];
  const price = await planPriceId(modules);
  if (item.price.id === price) return "skipped";
  await stripe.subscriptions.update(subscription.id, {
    items: [{ id: item.id, price }],
    proration_behavior: "create_prorations",
  });
  return "updated";
}

// Texting over the allowance, for the month before `now`: added to each
// billed studio's next invoice as one line (3c per text over 1,000).
// Recorded first so a month is never charged twice.
export async function chargeTextingOverage(now = DateTime.now().setZone("America/Chicago")) {
  const admin = createSupabaseAdminClient();
  const month = now.minus({ months: 1 }).startOf("month");
  const { data: studios } = await admin
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .not("stripe_customer_id", "is", null)
    .is("custom_monthly_price", null);
  const results: { studio: string; textsSent: number; charged: number }[] = [];
  for (const studio of studios ?? []) {
    const { count } = await admin
      .from("crm_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", studio.id)
      .eq("channel", "sms")
      .eq("direction", "outbound")
      .neq("status", "failed")
      .gte("created_at", month.toUTC().toISO()!)
      .lt("created_at", month.plus({ months: 1 }).toUTC().toISO()!);
    const sent = count ?? 0;
    const over = Math.max(0, sent - TEXTS_INCLUDED);
    if (over === 0) continue;
    const amountCents = Math.round(over * TEXT_OVERAGE * 100);
    const { data: recorded, error } = await admin
      .from("billing_overage_charges")
      .insert({
        organization_id: studio.id,
        month: month.toISODate(),
        texts_sent: sent,
        texts_over: over,
        amount_cents: amountCents,
      })
      .select("id")
      .maybeSingle();
    // Already charged for this month.
    if (error?.code === "23505") continue;
    if (error) throw error;
    const item = await getStripe().invoiceItems.create({
      customer: studio.stripe_customer_id!,
      currency: "usd",
      amount: amountCents,
      description: `Texts over ${TEXTS_INCLUDED.toLocaleString("en-US")} in ${month.toFormat("LLLL yyyy")}: ${over.toLocaleString("en-US")} × $${TEXT_OVERAGE.toFixed(2)}`,
      tax_behavior: "exclusive",
      tax_code: SAAS_TAX_CODE,
    });
    await admin.from("billing_overage_charges").update({ stripe_invoice_item_id: item.id }).eq("id", recorded!.id);
    results.push({ studio: studio.name ?? studio.id, textsSent: sent, charged: amountCents });
  }
  return results;
}

// Nightly safety net for the webhook: re-reads every billed studio's
// subscription from Stripe and corrects its status (payment failed,
// canceled, active again), and finishes any paid signup whose studio was
// never created (the owner closed the page and the webhook didn't arrive).
export async function reconcileBilling(inviteRedirect: string) {
  const admin = createSupabaseAdminClient();
  const stripe = getStripe();
  const corrected: { studio: string; from: string | null; to: string }[] = [];
  // One studio failing (e.g. a subscription made with the test key) never stops the rest.
  const failed: { studio: string; error: string }[] = [];
  const { data: studios } = await admin
    .from("organizations")
    .select("id, name, billing_status, stripe_subscription_id")
    .not("stripe_subscription_id", "is", null);
  for (const studio of studios ?? []) {
    try {
      const subscription = await stripe.subscriptions.retrieve(studio.stripe_subscription_id!);
      if (subscription.status !== studio.billing_status) {
        await syncSubscriptionStatus(subscription);
        corrected.push({ studio: studio.name ?? studio.id, from: studio.billing_status, to: subscription.status });
      }
    } catch (error) {
      failed.push({ studio: studio.name ?? studio.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Signups still pending after an hour (abandoned checkouts stay pending
  // and are skipped once Stripe says unpaid).
  const provisioned: string[] = [];
  const { data: pending } = await admin
    .from("studio_signups")
    .select("checkout_session_id, name")
    .eq("status", "pending")
    .not("checkout_session_id", "is", null)
    .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .gt("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());
  for (const signup of pending ?? []) {
    try {
      const result = await provisionCheckout(signup.checkout_session_id!, inviteRedirect);
      if (result.status === "provisioned") provisioned.push(signup.name);
    } catch (error) {
      failed.push({ studio: signup.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: studios?.length ?? 0, corrected, provisioned, failed };
}
