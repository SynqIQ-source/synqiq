import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStudioStripeAccount } from "@/lib/payments/connect";
import { cardPaymentsReady } from "@/lib/payments/checkout";
import { retryChargeNow, type Outcome } from "@/lib/billing/renewal-job";
import { saveMemberCard } from "@/lib/billing/member-cards";

// The card on file (membership billing step 3). A member's card is saved on
// the studio's own Stripe account with a SetupIntent, through Stripe's
// Payment Element: the card number goes from the browser straight to Stripe
// (or from Apple Pay / Google Pay), never through SynqIQ. SynqIQ keeps only
// brand, last 4 and expiry, copies the new card onto the member's payment
// schedules, and retries any declined monthly payment with it.
//
// Three ways in: staff at the desk (member profile), an emailed link, and the
// member app. All three end in finishCardUpdate, which re-reads the
// SetupIntent from Stripe; the payments webhook (setup_intent.succeeded) does
// the same if the browser is closed before it finishes.

export type { CardVia } from "@/lib/billing/member-cards";
import type { CardVia } from "@/lib/billing/member-cards";

export type CardSetup = { clientSecret: string; publishableKey: string; stripeAccountId: string };
export type CardResult = {
  card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; wallet: string | null };
  retried: Outcome[];
};

export async function startCardUpdate(
  organizationId: string,
  clientId: string,
  via: CardVia,
  staffId: string | null,
): Promise<{ error: string } | CardSetup> {
  const admin = createSupabaseAdminClient();
  if (!(await cardPaymentsReady(admin, organizationId))) return { error: "Card payments aren't set up for this studio yet." };
  const account = (await getStudioStripeAccount(admin, organizationId))!;
  const stripe = getStripe();
  // Reuse the member's Stripe customer on this account if they have one.
  const { data: saved } = await admin
    .from("member_cards")
    .select("stripe_customer_id, stripe_account_id")
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId)
    .eq("livemode", account.livemode)
    .maybeSingle();
  let customerId = saved?.stripe_account_id === account.stripeAccountId ? (saved.stripe_customer_id as string) : null;
  if (!customerId) {
    const { data: schedule } = await admin
      .from("member_billing_schedules")
      .select("stripe_customer_id")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .eq("stripe_account_id", account.stripeAccountId)
      .not("stripe_customer_id", "is", null)
      .limit(1)
      .maybeSingle();
    customerId = (schedule?.stripe_customer_id as string | null) ?? null;
  }
  if (!customerId) {
    const { data: client } = await admin
      .from("clients")
      .select("first_name, last_name")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .maybeSingle();
    const name = [client?.first_name, client?.last_name].filter(Boolean).join(" ") || undefined;
    const customer = await stripe.customers.create(
      { name, metadata: { synqiq_client: clientId } },
      { stripeAccount: account.stripeAccountId, idempotencyKey: `synqiq-customer-${organizationId}-${clientId}-${account.livemode}` },
    );
    customerId = customer.id;
  }
  const intent = await stripe.setupIntents.create(
    {
      customer: customerId,
      usage: "off_session",
      // Cards, including Apple Pay / Google Pay wallets (no bank debits).
      allowed_payment_method_types: ["card"],
      description: "Card on file for monthly membership payments",
      metadata: {
        synqiq_card_update: "1",
        synqiq_organization_id: organizationId,
        synqiq_client: clientId,
        synqiq_via: via,
        synqiq_staff: staffId ?? "",
      },
    } as Stripe.SetupIntentCreateParams,
    { stripeAccount: account.stripeAccountId },
  );
  return {
    clientSecret: intent.client_secret!,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
    stripeAccountId: account.stripeAccountId,
  };
}

function cardFrom(method: Stripe.PaymentMethod | string | null) {
  const card = method && typeof method === "object" ? method.card : null;
  return {
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
    wallet: (card?.wallet?.type as string | undefined) ?? null,
  };
}

// Save a card the member just set up. `expect` pins the studio and member the
// caller is allowed to act for; the webhook passes only the account.
export async function finishCardUpdate(
  setupIntentId: string,
  expect: { organizationId?: string; clientId?: string; accountId?: string },
): Promise<{ error: string } | CardResult> {
  const admin = createSupabaseAdminClient();
  if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) return { error: "Card not found." };
  let accountId = expect.accountId ?? null;
  if (!accountId && expect.organizationId)
    accountId = (await getStudioStripeAccount(admin, expect.organizationId))?.stripeAccountId ?? null;
  if (!accountId) return { error: "Card not found." };
  const intent = await getStripe().setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] }, { stripeAccount: accountId });
  const organizationId = intent.metadata?.synqiq_organization_id ?? "";
  const clientId = intent.metadata?.synqiq_client ?? "";
  if (intent.metadata?.synqiq_card_update !== "1" || !organizationId || !clientId) return { error: "Card not found." };
  if ((expect.organizationId && expect.organizationId !== organizationId) || (expect.clientId && expect.clientId !== clientId))
    return { error: "Card not found." };
  if (intent.status !== "succeeded")
    return { error: intent.status === "processing" ? "The card is still being checked." : "The card wasn't saved." };
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (!paymentMethodId || !customerId) return { error: "The card wasn't saved." };
  const card = cardFrom(intent.payment_method as Stripe.PaymentMethod);
  const via = (["desk", "link", "app"].includes(intent.metadata?.synqiq_via ?? "") ? intent.metadata!.synqiq_via : "desk") as CardVia;
  const staffId = /^[0-9a-f-]{36}$/i.test(intent.metadata?.synqiq_staff ?? "") ? intent.metadata!.synqiq_staff : null;

  // Already saved (the browser and the webhook both finish): nothing to redo.
  const { data: current } = await admin
    .from("member_cards")
    .select("stripe_payment_method_id")
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId)
    .eq("livemode", intent.livemode)
    .maybeSingle();
  if (current?.stripe_payment_method_id === paymentMethodId) return { card, retried: [] };

  await saveMemberCard(admin, {
    organizationId,
    clientId,
    livemode: intent.livemode,
    accountId,
    customerId,
    paymentMethodId,
    card,
    via,
    staffId,
  });
  // Stripe: this card is the customer's default from now on.
  await getStripe()
    .customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } }, { stripeAccount: accountId })
    .catch((error) => console.error("[billing/cards] default card not set:", error));

  // Retry any declined month with the new card (booking comes back once paid).
  const { data: schedules } = await admin
    .from("member_billing_schedules")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId)
    .eq("stripe_account_id", accountId);
  const retried: Outcome[] = [];
  if (schedules?.length) {
    const { data: open } = await admin
      .from("membership_charges")
      .select("id")
      .in(
        "schedule_id",
        schedules.map((row) => row.id as string),
      )
      .in("status", ["declined", "failed"])
      .order("due_date");
    for (const charge of open ?? []) {
      const result = await retryChargeNow(organizationId, charge.id as string);
      if ("outcome" in result) retried.push(result.outcome);
    }
  }
  return { card, retried };
}
