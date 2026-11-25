import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/billing/card-links";
export { createConfirmLink, needsApproval } from "@/lib/billing/card-links";
import { markPaid } from "@/lib/billing/renewal-job";

// Renewals the member's bank wants them to approve (3D Secure). The nightly
// run charges off-session, so a bank that asks for a code or an app approval
// can't be satisfied: Stripe reports "authentication_required". That isn't a
// bad card, so instead of "update your card" the member gets a one-time link
// (7 days) to approve that same payment on a SynqIQ page: Stripe shows the
// bank's check there, and the payment goes through. If they never approve,
// the normal retry / on-hold rules apply.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ConfirmLink = { id: string; organizationId: string; clientId: string; chargeId: string };

export async function findConfirmLink(token: string): Promise<ConfirmLink | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("card_update_links")
    .select("id, organization_id, mindbody_client_id, expires_at, used_at, reason, charge_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.reason !== "confirm" || !data.charge_id || data.used_at || Date.parse(data.expires_at as string) < Date.now())
    return null;
  return {
    id: data.id as string,
    organizationId: data.organization_id as string,
    clientId: data.mindbody_client_id as string,
    chargeId: data.charge_id as string,
  };
}

type ChargeRow = {
  id: string;
  schedule_id: string;
  status: string;
  total_cents: number;
  payment_intent_id: string | null;
  stripe_account_id: string | null;
  due_date: string;
};

async function loadCharge(admin: Admin, link: ConfirmLink) {
  const { data } = await admin
    .from("membership_charges")
    .select("id, schedule_id, status, total_cents, payment_intent_id, stripe_account_id, due_date")
    .eq("id", link.chargeId)
    .eq("organization_id", link.organizationId)
    .eq("mindbody_client_id", link.clientId)
    .maybeSingle<ChargeRow>();
  return data;
}

// What the page shows: studio, first name, membership, amount, and whether
// it's still waiting to be approved.
export async function confirmSummary(link: ConfirmLink) {
  const admin = createSupabaseAdminClient();
  const charge = await loadCharge(admin, link);
  if (!charge) return null;
  const [{ data: org }, { data: client }, { data: schedule }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", link.organizationId).maybeSingle(),
    admin.from("clients").select("first_name").eq("organization_id", link.organizationId).eq("mindbody_client_id", link.clientId).maybeSingle(),
    admin.from("member_billing_schedules").select("name, card_brand, card_last4").eq("id", charge.schedule_id).maybeSingle(),
  ]);
  return {
    studioName: (org?.name as string | null) ?? "Your studio",
    firstName: (client?.first_name as string | null) ?? "",
    membership: (schedule?.name as string | null) ?? "membership",
    card: schedule?.card_last4 ? `${schedule.card_brand ? String(schedule.card_brand) : "Card"} ending ${schedule.card_last4}` : null,
    amountCents: Number(charge.total_cents),
    dueDate: charge.due_date,
    paid: charge.status === "paid",
    open: ["declined", "failed", "processing"].includes(charge.status),
  };
}

// Start: the payment's client secret and card, so the page can ask Stripe to
// run the bank's check on that same payment. Already paid -> say so.
export async function startPaymentConfirm(
  link: ConfirmLink,
): Promise<
  | { error: string }
  | { paid: true }
  | { clientSecret: string; paymentMethodId: string; publishableKey: string; stripeAccountId: string; amountCents: number }
> {
  const admin = createSupabaseAdminClient();
  const charge = await loadCharge(admin, link);
  if (!charge) return { error: "This payment wasn't found." };
  if (charge.status === "paid") return { paid: true };
  if (!["declined", "failed"].includes(charge.status) || !charge.payment_intent_id || !charge.stripe_account_id)
    return { error: "This payment can't be approved here. Please contact the front desk." };
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) return { error: "Card payments aren't available right now." };
  const intent = await getStripe().paymentIntents.retrieve(charge.payment_intent_id, {}, { stripeAccount: charge.stripe_account_id });
  if (intent.metadata?.synqiq_membership_charge_id !== charge.id) return { error: "This payment wasn't found." };
  if (intent.status === "succeeded") {
    await markPaid(admin, charge.id, charge.schedule_id, intent.id);
    return { paid: true };
  }
  if (!["requires_payment_method", "requires_action", "requires_confirmation"].includes(intent.status))
    return { error: "This payment is being processed. Please check back in a few minutes." };
  const lastMethod = intent.last_payment_error?.payment_method?.id;
  const attached = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  const { data: schedule } = await admin
    .from("member_billing_schedules")
    .select("stripe_payment_method_id")
    .eq("id", charge.schedule_id)
    .maybeSingle();
  const paymentMethodId = lastMethod ?? attached ?? (schedule?.stripe_payment_method_id as string | null) ?? null;
  if (!paymentMethodId) return { error: "There's no card on file for this payment. Please update your card." };
  return {
    clientSecret: intent.client_secret!,
    paymentMethodId,
    publishableKey,
    stripeAccountId: charge.stripe_account_id,
    amountCents: Number(charge.total_cents),
  };
}

// Finish: re-read the payment from Stripe (never trust the page) and record it.
export async function finishPaymentConfirm(link: ConfirmLink, paymentIntentId: string): Promise<{ error: string } | { paid: true }> {
  const admin = createSupabaseAdminClient();
  const charge = await loadCharge(admin, link);
  if (!charge || !charge.stripe_account_id) return { error: "This payment wasn't found." };
  if (charge.status === "paid") return { paid: true };
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return { error: "This payment wasn't found." };
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: charge.stripe_account_id });
  if (intent.metadata?.synqiq_membership_charge_id !== charge.id) return { error: "This payment wasn't found." };
  if (intent.status !== "succeeded" || intent.amount_received !== Number(charge.total_cents))
    return { error: "The payment wasn't approved. Please try again, or contact the front desk." };
  await markPaid(admin, charge.id, charge.schedule_id, intent.id);
  await admin.from("card_update_links").update({ used_at: new Date().toISOString() }).eq("id", link.id);
  return { paid: true };
}
