import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type CardVia = "desk" | "link" | "app" | "pos";

// Record a member's card and put it on their payment schedules (the ones on
// the same Stripe account, or not on one yet).
export async function saveMemberCard(
  admin: Admin,
  input: {
    organizationId: string;
    clientId: string;
    livemode: boolean;
    accountId: string;
    customerId: string;
    paymentMethodId: string;
    card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; wallet?: string | null };
    via: CardVia;
    staffId: string | null;
  },
) {
  await admin.from("member_cards").upsert(
    {
      organization_id: input.organizationId,
      mindbody_client_id: input.clientId,
      livemode: input.livemode,
      stripe_account_id: input.accountId,
      stripe_customer_id: input.customerId,
      stripe_payment_method_id: input.paymentMethodId,
      card_brand: input.card.brand,
      card_last4: input.card.last4,
      card_exp_month: input.card.expMonth,
      card_exp_year: input.card.expYear,
      wallet: input.card.wallet ?? null,
      updated_via: input.via,
      updated_by_staff_id: input.staffId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,mindbody_client_id,livemode" },
  );
  const cardFields = {
    stripe_account_id: input.accountId,
    stripe_customer_id: input.customerId,
    stripe_payment_method_id: input.paymentMethodId,
    card_brand: input.card.brand,
    card_last4: input.card.last4,
    card_exp_month: input.card.expMonth,
    card_exp_year: input.card.expYear,
  };
  // Live cards go on live (active) schedules; test cards on practice ones.
  await admin
    .from("member_billing_schedules")
    .update(cardFields)
    .eq("organization_id", input.organizationId)
    .eq("mindbody_client_id", input.clientId)
    .eq("status", input.livemode ? "active" : "practice")
    .or(`stripe_account_id.is.null,stripe_account_id.eq.${input.accountId}`);
}
