import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Each studio's own Stripe account (Stripe Connect, Accounts v2,
// Standard-style), per Stripe's recommendation for SynqIQ (2026-11-11):
//   - one connected account per studio, Merchant configuration,
//     card_payments capability, full Stripe Dashboard;
//   - Stripe collects fees and losses from the studio (cannot be changed
//     after the account is created -- confirmed before production);
//   - member payments are direct charges in the studio's account.
// The studio -> account mapping is stored and enforced only on the server.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const CONNECT_RESPONSIBILITIES = { fees_collector: "stripe", losses_collector: "stripe" } as const;

// Creating accounts for real studios is switched on deliberately, after
// Stripe has confirmed the platform setup (test-mode keys always work).
export function connectCreationAllowed(secretKey: string | undefined): boolean {
  if (!secretKey) return false;
  if (secretKey.startsWith("sk_test_")) return true;
  return process.env.STRIPE_CONNECT_LIVE === "true";
}

export type StudioStripeAccount = {
  stripeAccountId: string;
  livemode: boolean;
  ready: boolean;
  cardPaymentsStatus: string | null;
  requirementsDue: string[];
};

export async function getStudioStripeAccount(admin: Admin, organizationId: string): Promise<StudioStripeAccount | null> {
  const { data } = await admin
    .from("stripe_connected_accounts")
    .select("stripe_account_id, livemode, ready, card_payments_status, requirements_due")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  return {
    stripeAccountId: data.stripe_account_id as string,
    livemode: Boolean(data.livemode),
    ready: Boolean(data.ready),
    cardPaymentsStatus: (data.card_payments_status as string | null) ?? null,
    requirementsDue: (data.requirements_due as string[] | null) ?? [],
  };
}

// The account's readiness, from Stripe's account record: card payments
// active and nothing currently due. Returning from onboarding alone never
// means ready.
export function readinessFrom(account: Stripe.V2.Core.Account): {
  cardPaymentsStatus: string | null;
  ready: boolean;
  requirementsDue: string[];
} {
  const cardPaymentsStatus = account.configuration?.merchant?.capabilities?.card_payments?.status ?? null;
  const entries = (account.requirements?.entries ?? []) as {
    description?: string;
    awaiting_action_from?: string;
    minimum_deadline?: { status?: string };
  }[];
  const requirementsDue = entries
    .filter((entry) => entry.minimum_deadline?.status === "currently_due" || entry.minimum_deadline?.status === "past_due")
    .map((entry) => entry.description ?? "Information needed")
    .slice(0, 20);
  return { cardPaymentsStatus, ready: cardPaymentsStatus === "active" && requirementsDue.length === 0, requirementsDue };
}

// Create the studio's connected account (once). Returns the account id.
export async function createStudioAccount(
  admin: Admin,
  input: { organizationId: string; studioName: string; contactEmail: string | null; staffId: string },
): Promise<string> {
  const existing = await getStudioStripeAccount(admin, input.organizationId);
  if (existing) return existing.stripeAccountId;
  const stripe = getStripe();
  const account = await stripe.v2.core.accounts.create(
    {
      display_name: input.studioName,
      contact_email: input.contactEmail ?? undefined,
      dashboard: "full",
      identity: { country: "us" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { currency: "usd", responsibilities: { ...CONNECT_RESPONSIBILITIES } },
      include: ["configuration.merchant", "requirements"],
    },
    // One account per studio even if the button is pressed twice.
    { idempotencyKey: `synqiq-connect-account-${input.organizationId}` },
  );
  const readiness = readinessFrom(account);
  const { error } = await admin.from("stripe_connected_accounts").insert({
    organization_id: input.organizationId,
    stripe_account_id: account.id,
    livemode: Boolean(account.livemode),
    display_name: input.studioName,
    card_payments_status: readiness.cardPaymentsStatus,
    ready: readiness.ready,
    requirements_due: readiness.requirementsDue,
    last_checked_at: new Date().toISOString(),
    created_by_staff_id: input.staffId,
  });
  if (error) throw new Error(error.message);
  return account.id;
}

// A fresh Stripe-hosted onboarding link (links expire; make a new one each
// time the studio starts or resumes onboarding).
export async function onboardingLink(stripeAccountId: string, origin: string): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.v2.core.accountLinks.create({
    account: stripeAccountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant"],
        refresh_url: `${origin}/dashboard/settings/payments?resume=1`,
        return_url: `${origin}/dashboard/settings/payments?returned=1`,
      },
    } as Stripe.V2.Core.AccountLinkCreateParams.UseCase,
  });
  return link.url;
}

// Re-read the account from Stripe and store whether it can take payments.
export async function refreshStudioAccount(admin: Admin, organizationId: string): Promise<StudioStripeAccount | null> {
  const current = await getStudioStripeAccount(admin, organizationId);
  if (!current) return null;
  const stripe = getStripe();
  const account = await stripe.v2.core.accounts.retrieve(current.stripeAccountId, { include: ["configuration.merchant", "requirements"] });
  const readiness = readinessFrom(account);
  const now = new Date().toISOString();
  await admin
    .from("stripe_connected_accounts")
    .update({
      card_payments_status: readiness.cardPaymentsStatus,
      ready: readiness.ready,
      requirements_due: readiness.requirementsDue,
      last_checked_at: now,
      ...(readiness.ready && !current.ready ? { ready_at: now } : {}),
    })
    .eq("organization_id", organizationId);
  return { ...current, ...readiness };
}
