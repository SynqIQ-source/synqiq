import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Membership billing step 5: refunds and disputes.
// - A Club Admin or Sales Lead voids a renewal sale -> the month is refunded
//   to the card (SynqIQ's fee returned too) and the charge marked refunded.
// - A refund made in the studio's Stripe dashboard -> the matching SynqIQ sale
//   (POS or renewal) is voided when it's refunded in full.
// - A dispute (chargeback) -> recorded and listed on Member Billing; the studio
//   answers it in its own Stripe dashboard.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function refundRenewalSale(
  admin: Admin,
  organizationId: string,
  saleId: string,
): Promise<{ error: string } | { refunded: number }> {
  const { data: charge } = await admin
    .from("membership_charges")
    .select("id, status, payment_intent_id, stripe_account_id, total_cents")
    .eq("organization_id", organizationId)
    .eq("sale_id", saleId)
    .maybeSingle();
  if (!charge) return { refunded: 0 };
  if (charge.status === "refunded") return { refunded: 0 };
  if (charge.status !== "paid" || !charge.payment_intent_id || !charge.stripe_account_id)
    return { error: "This renewal wasn't paid by card." };
  try {
    await getStripe().refunds.create(
      { payment_intent: charge.payment_intent_id as string, refund_application_fee: true, metadata: { synqiq_sale_id: saleId } },
      { stripeAccount: charge.stripe_account_id as string, idempotencyKey: `synqiq-renewal-refund-${charge.id}` },
    );
  } catch (error) {
    console.error("[billing/refunds] refund failed:", error);
    return { error: "Stripe couldn't refund the card. The sale was not voided." };
  }
  const now = new Date().toISOString();
  await admin.from("membership_charges").update({ status: "refunded", refunded_at: now, updated_at: now }).eq("id", charge.id);
  return { refunded: Number(charge.total_cents) };
}

// Webhook charge.refunded: a refund made outside SynqIQ (Stripe dashboard).
export async function applyStripeRefund(charge: Stripe.Charge, accountId: string) {
  const admin = createSupabaseAdminClient();
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;
  const full = charge.refunded || charge.amount_refunded >= charge.amount;
  const now = new Date().toISOString();
  const { data: renewal } = await admin
    .from("membership_charges")
    .select("id, status, sale_id")
    .eq("payment_intent_id", paymentIntentId)
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (renewal && full && renewal.status === "paid")
    await admin.from("membership_charges").update({ status: "refunded", refunded_at: now, updated_at: now }).eq("id", renewal.id);
  const { data: card } = await admin
    .from("pos_card_payments")
    .select("id, sale_id")
    .eq("payment_intent_id", paymentIntentId)
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (card) await admin.from("pos_card_payments").update({ refunded_cents: charge.amount_refunded }).eq("id", card.id);
  const saleId = (renewal?.sale_id as string | null) ?? (card?.sale_id as string | null) ?? null;
  if (!saleId || !full) return;
  await admin
    .from("pos_sales")
    .update({ status: "voided", voided_at: now, void_reason: "Refunded in Stripe" })
    .eq("id", saleId)
    .neq("status", "voided");
}

// Webhook charge.dispute.*: record the dispute and where it stands.
export async function recordDispute(dispute: Stripe.Dispute, accountId: string, livemode: boolean) {
  const admin = createSupabaseAdminClient();
  const paymentIntentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
  const { data: account } = await admin
    .from("stripe_connected_accounts")
    .select("organization_id")
    .eq("stripe_account_id", accountId)
    .limit(1)
    .maybeSingle();
  if (!account) return;
  let saleId: string | null = null;
  let clientId: string | null = null;
  if (paymentIntentId) {
    const { data: sale } = await admin
      .from("pos_sales")
      .select("id, mindbody_client_id")
      .eq("organization_id", account.organization_id)
      .eq("payment_ref", paymentIntentId)
      .maybeSingle();
    saleId = (sale?.id as string | null) ?? null;
    clientId = (sale?.mindbody_client_id as string | null) ?? null;
  }
  await admin.from("payment_disputes").upsert(
    {
      id: dispute.id,
      organization_id: account.organization_id,
      stripe_account_id: accountId,
      livemode,
      payment_intent_id: paymentIntentId,
      sale_id: saleId,
      mindbody_client_id: clientId,
      amount_cents: dispute.amount,
      reason: dispute.reason,
      status: dispute.status,
      evidence_due_by: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}
