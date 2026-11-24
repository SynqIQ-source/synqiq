import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/studio-templates";
import { getOptionalEnv } from "@/lib/env";

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

// Webhook refund.failed: a refund Stripe accepted later failed (closed or
// replaced card, for example), so the money went back to the studio's
// balance and the member wasn't paid back -- while SynqIQ already shows the
// sale voided. Club Admins are emailed to refund the member another way.
export async function noteFailedRefund(refund: Stripe.Refund, accountId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: account } = await admin
    .from("stripe_connected_accounts")
    .select("organization_id")
    .eq("stripe_account_id", accountId)
    .limit(1)
    .maybeSingle();
  if (!account) return false;
  const organizationId = account.organization_id as string;
  const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : (refund.payment_intent?.id ?? null);
  const [{ data: sale }, { data: admins }] = await Promise.all([
    paymentIntentId
      ? admin
          .from("pos_sales")
          .select("id, client_name, created_at")
          .eq("organization_id", organizationId)
          .eq("payment_ref", paymentIntentId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("staff")
      .select("display_name, email")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .is("archived_at", null)
      .not("email", "is", null),
  ]);
  const to = (admins ?? [])
    .filter((row): row is typeof row & { email: string } => Boolean(row.email))
    .map((row) => ({ email: row.email, displayName: row.display_name as string | null }));
  if (!to.length) return false;
  const amount = `$${(refund.amount / 100).toFixed(2)}`;
  const member = (sale?.client_name as string | null) || "a member";
  const soldOn = sale?.created_at
    ? new Date(sale.created_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })
    : null;
  const reason = refund.failure_reason ? refund.failure_reason.replace(/_/g, " ") : "not given";
  const siteUrl = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
  await sendEmailToRecipients(to, {
    subject: `A card refund of ${amount} failed`,
    html: `<p>A card refund of <strong>${escapeHtml(amount)}</strong> to <strong>${escapeHtml(member)}</strong>${
      soldOn ? ` (sale on ${escapeHtml(soldOn)})` : ""
    } failed after Stripe accepted it. Reason from Stripe: ${escapeHtml(reason)}.</p>
<p>The money went back to the studio's Stripe balance, so the member has <strong>not</strong> been paid back, even though the sale shows as voided in SynqIQ. Please refund them another way (cash or check) and let them know.</p>
<p>Stripe refund: ${escapeHtml(refund.id)}${paymentIntentId ? ` · payment ${escapeHtml(paymentIntentId)}` : ""}</p>
<p><a href="${escapeHtml(siteUrl)}/dashboard/member-billing">Open Member Billing</a></p>`,
  });
  return true;
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
