import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStudioStripeAccount, stripeLivemode } from "@/lib/payments/connect";
import { saveMemberCard } from "@/lib/billing/member-cards";
import { ensureMemberId } from "@/lib/members/ids";
import { savePracticeSale, type SaleLineRequest } from "@/lib/pos/sales";
import type { AgreementSignatureRequest } from "@/lib/agreements/sale";
import type { CurrentStaff } from "@/lib/current-staff";

// Card payments at checkout: DIRECT charges in the studio's own Stripe
// account (Stripe's recommendation for SynqIQ, 2026-11-11).
//
//   start   -> validate the whole sale (prices, tax, signatures) on the
//              server, record a pending payment, create the PaymentIntent in
//              the studio's account; the browser gets only the client secret.
//   finish  -> after the browser confirms, re-read the PaymentIntent from
//              Stripe; only a succeeded intent for the exact amount saves the
//              sale. The Connect payments webhook calls the same finish, so a
//              closed browser still records the sale. Finishing twice is
//              harmless: the pending -> finalizing step happens once.
//
// The studio's account comes only from stripe_connected_accounts (server
// side). The browser never picks or overrides it. Card details go straight
// from Stripe's Payment Element to Stripe.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type CardSaleRequest = {
  clientId: string | null;
  clientName: string | null;
  lines: SaleLineRequest[];
  promoCode: string | null;
  note: string | null;
  agreements: AgreementSignatureRequest[];
  evidence: { ip: string | null; userAgent: string | null };
  billingStart?: "signup" | "prorated";
  // Bought online / in the member app (no staff member; lib/online/buy.ts).
  online?: boolean;
};

// Stands in for the staff member on online purchases: the sale and card
// payment are saved with no staff_id and source "online".
export function onlineActor(organizationId: string): CurrentStaff {
  return {
    id: "",
    displayName: "Online purchase",
    role: "staff",
    organizationId,
    title: null,
    photoUrl: null,
    canSell: false,
    isInstructor: false,
    isTrainer: false,
    isFacilityTech: false,
    mfa: "ok",
  } as CurrentStaff;
}

// SynqIQ's application fee on studio card payments, in basis points: 0.5%
// on top of Stripe's rate (Adam, 2026-11-18). The other 0.5% of SynqIQ's
// share comes from Stripe's revenue share, not from this fee. Override with
// SYNQIQ_APPLICATION_FEE_BPS (e.g. 0 to switch it off).
export const DEFAULT_APPLICATION_FEE_BPS = 50;
export function applicationFeeCents(
  amountCents: number,
  basisPoints = Number(process.env.SYNQIQ_APPLICATION_FEE_BPS ?? DEFAULT_APPLICATION_FEE_BPS),
): number {
  if (!Number.isFinite(basisPoints) || basisPoints <= 0) return 0;
  return Math.floor((amountCents * Math.min(basisPoints, 1000)) / 10_000);
}

// Card payments are offered only when the studio's account for the server's
// key mode is ready, and live charges only once switched on deliberately.
export async function cardPaymentsReady(admin: Admin, organizationId: string): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY) return false;
  if (stripeLivemode() && process.env.STRIPE_CONNECT_LIVE !== "true") return false;
  const account = await getStudioStripeAccount(admin, organizationId);
  return Boolean(account?.ready && account.livemode === stripeLivemode());
}

export async function startCardPayment(
  staff: CurrentStaff,
  request: CardSaleRequest,
): Promise<
  { error: string } | { paymentId: string; clientSecret: string; publishableKey: string; stripeAccountId: string; amountCents: number }
> {
  const admin = createSupabaseAdminClient();
  if (!(await cardPaymentsReady(admin, staff.organizationId))) return { error: "Card payments aren't set up for this studio yet." };
  const account = (await getStudioStripeAccount(admin, staff.organizationId))!;
  const checked = await savePracticeSale(staff, { ...request, validateOnly: true });
  if ("error" in checked) return checked;
  if (!("totalCents" in checked)) return { error: "Couldn't check the sale. Try again." };
  if (checked.totalCents < 50) return { error: "Card payments need a total of at least $0.50." };
  // A guest or lead joining: they get their member ID before the card is
  // charged (from Mindbody for now; lib/members/ids.ts). Practice and
  // test-mode sales never create one.
  if (checked.recurring && account.livemode && request.clientId?.startsWith("crm:")) {
    const assigned = await ensureMemberId(admin, staff.organizationId, request.clientId.slice(4));
    if ("error" in assigned) return assigned;
  }

  const stripe = getStripe();
  const fee = applicationFeeCents(checked.totalCents);
  // Memberships renew monthly: keep the card on a customer in the studio's
  // account so renewals can be charged off-session later.
  let customerId: string | null = null;
  if (checked.recurring) {
    const customer = await stripe.customers.create(
      { name: request.clientName ?? undefined, metadata: { synqiq_client: request.clientId ?? "" } },
      { stripeAccount: account.stripeAccountId },
    );
    customerId = customer.id;
  }
  const { data: row, error } = await admin
    .from("pos_card_payments")
    .insert({
      organization_id: staff.organizationId,
      staff_id: staff.id || null,
      source: request.online ? "online" : "pos",
      stripe_account_id: account.stripeAccountId,
      livemode: account.livemode,
      stripe_customer_id: customerId,
      amount_cents: checked.totalCents,
      application_fee_cents: fee,
      sale_request: request,
    })
    .select("id")
    .single();
  if (error || !row) return { error: "Couldn't start the payment. Try again." };
  const params: Stripe.PaymentIntentCreateParams = {
    amount: checked.totalCents,
    currency: "usd",
    // Cards only (no bank debits or pay-later), at the desk and online.
    allowed_payment_method_types: ["card"],
    description: `SynqIQ ${request.online ? "online purchase" : "checkout"}${request.clientName ? ` · ${request.clientName}` : ""}`,
    metadata: { synqiq_payment_id: row.id as string, synqiq_organization_id: staff.organizationId },
    ...(customerId ? { customer: customerId, setup_future_usage: "off_session" as const } : {}),
    ...(fee > 0 ? { application_fee_amount: fee } : {}),
  };
  try {
    const intent = await stripe.paymentIntents.create(params, {
      stripeAccount: account.stripeAccountId,
      idempotencyKey: `synqiq-pos-payment-${row.id}`,
    });
    await admin.from("pos_card_payments").update({ payment_intent_id: intent.id }).eq("id", row.id);
    return {
      paymentId: row.id as string,
      clientSecret: intent.client_secret!,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
      stripeAccountId: account.stripeAccountId,
      amountCents: checked.totalCents,
    };
  } catch (stripeError) {
    console.error("[payments/checkout] create intent failed:", stripeError);
    await admin.from("pos_card_payments").update({ status: "cancelled", last_error: "Couldn't create the payment" }).eq("id", row.id);
    return { error: "Couldn't start the card payment. Try again." };
  }
}

type FinishResult = { error: string; paid?: boolean } | { saleId: string; saleNumber: number; livemode: boolean };

// Save the sale for a payment Stripe has confirmed. `organizationId` is
// given when a staff member finishes from checkout (must match); the webhook
// passes null and relies on the account check instead.
export async function finishCardPayment(paymentId: string, organizationId: string | null, eventAccountId?: string): Promise<FinishResult> {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("pos_card_payments")
    .select(
      "id, organization_id, staff_id, stripe_account_id, livemode, payment_intent_id, stripe_customer_id, amount_cents, status, sale_id, sale_request, on_file_purpose",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!row || (organizationId && row.organization_id !== organizationId)) return { error: "Payment not found." };
  if (eventAccountId && eventAccountId !== row.stripe_account_id) return { error: "Payment not found." };
  if (row.status === "completed" && row.sale_id) return savedSale(admin, row.sale_id as string, Boolean(row.livemode));
  if (row.status !== "pending" || !row.payment_intent_id)
    return { error: statusMessage(row.status as string), paid: row.status !== "cancelled" };

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(
    row.payment_intent_id as string,
    { expand: ["payment_method"] },
    { stripeAccount: row.stripe_account_id as string },
  );
  if (intent.status !== "succeeded")
    return { error: intent.status === "processing" ? "The payment is still processing." : "The card wasn't charged." };
  if (intent.amount_received !== row.amount_cents || intent.metadata?.synqiq_payment_id !== row.id)
    return markAttention(admin, row.id as string, "Charged amount doesn't match the sale");

  // Claim it: only one finisher (checkout or webhook) gets past this.
  const { data: claimed } = await admin
    .from("pos_card_payments")
    .update({ status: "finalizing" })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return { error: "This payment is already being saved.", paid: true };

  let staff: CurrentStaff;
  if (!row.staff_id) {
    // Online purchase: no staff member.
    staff = onlineActor(row.organization_id as string);
  } else {
    const { data: staffRow } = await admin
      .from("staff")
      .select("id, display_name, role, organization_id")
      .eq("id", row.staff_id)
      .maybeSingle();
    if (!staffRow) return markAttention(admin, row.id as string, "Staff member not found");
    // Only the fields the sale saver reads; permissions were checked at start.
    staff = {
      id: staffRow.id as string,
      displayName: (staffRow.display_name as string | null) ?? "Staff",
      role: staffRow.role,
      organizationId: staffRow.organization_id as string,
    } as CurrentStaff;
  }
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null);
  const saved = await savePracticeSale(staff, {
    ...(row.sale_request as CardSaleRequest),
    payment: {
      livemode: Boolean(row.livemode),
      paymentIntentId: intent.id,
      amountCents: intent.amount_received,
      stripeAccountId: row.stripe_account_id as string,
      customerId: (row.stripe_customer_id as string | null) ?? null,
      paymentMethodId,
      card: savedCard(intent.payment_method),
    },
  });
  if ("error" in saved) return markAttention(admin, row.id as string, saved.error);
  if (!("saleId" in saved)) return markAttention(admin, row.id as string, "Sale not saved");
  // A membership's card becomes the member's card on file.
  const request = row.sale_request as CardSaleRequest;
  const card = savedCard(intent.payment_method);
  // (Not when the sale was charged to a card already on file.) A guest who
  // just joined is keyed by the member ID they were given.
  let memberId = request.clientId;
  if (memberId?.startsWith("crm:")) {
    const { data: contact } = await admin.from("crm_contacts").select("mindbody_client_id").eq("id", memberId.slice(4)).maybeSingle();
    memberId = (contact?.mindbody_client_id as string | null) ?? null;
  }
  if (!row.on_file_purpose && row.stripe_customer_id && paymentMethodId && card && memberId) {
    await saveMemberCard(admin, {
      organizationId: row.organization_id as string,
      clientId: memberId,
      livemode: Boolean(row.livemode),
      accountId: row.stripe_account_id as string,
      customerId: row.stripe_customer_id as string,
      paymentMethodId,
      card,
      via: row.staff_id ? "pos" : "app",
      staffId: (row.staff_id as string | null) ?? null,
    }).catch((error) => console.error("[payments/checkout] card on file not saved:", error));
  }
  await admin
    .from("pos_card_payments")
    .update({
      status: "completed",
      sale_id: saved.saleId,
      stripe_payment_method_id: paymentMethodId,
      completed_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  return { saleId: saved.saleId, saleNumber: saved.saleNumber, livemode: Boolean(row.livemode) };
}

// Brand, last 4 and expiry of the card used (for monthly billing and the
// expiring-card list); Stripe keeps the card itself.
function savedCard(method: unknown) {
  const card = (method && typeof method === "object" ? (method as { card?: Record<string, unknown> }).card : null) ?? null;
  if (!card) return null;
  return {
    brand: typeof card.brand === "string" ? card.brand : null,
    last4: typeof card.last4 === "string" ? card.last4 : null,
    expMonth: typeof card.exp_month === "number" ? card.exp_month : null,
    expYear: typeof card.exp_year === "number" ? card.exp_year : null,
  };
}

// "Charge card on file" at the POS: a named member's saved card is charged
// with no card present (off-session) on the studio's Stripe account. The
// retail card is used; if the member has none, the dues card only after the
// staff member confirms (`allowDuesCard`). The sale then saves exactly like a
// card sale (finishCardPayment re-reads the payment from Stripe).
export async function chargeCardOnFile(
  staff: CurrentStaff,
  request: CardSaleRequest,
  allowDuesCard: boolean,
): Promise<{ error: string } | { needsDuesConfirm: string } | FinishResult> {
  const admin = createSupabaseAdminClient();
  if (!(await cardPaymentsReady(admin, staff.organizationId))) return { error: "Card payments aren't set up for this studio yet." };
  const account = (await getStudioStripeAccount(admin, staff.organizationId))!;
  const clientId = request.clientId;
  if (!clientId || clientId.startsWith("crm:")) return { error: "Pick a member with a card on file." };
  const { data: cards } = await admin
    .from("member_cards")
    .select("purpose, stripe_customer_id, stripe_payment_method_id, card_brand, card_last4")
    .eq("organization_id", staff.organizationId)
    .eq("mindbody_client_id", clientId)
    .eq("livemode", account.livemode)
    .eq("stripe_account_id", account.stripeAccountId);
  const retail = (cards ?? []).find((row) => row.purpose === "retail");
  const dues = (cards ?? []).find((row) => row.purpose === "dues");
  const label = (row: typeof dues) =>
    `${row?.card_brand ? String(row.card_brand)[0].toUpperCase() + String(row.card_brand).slice(1) : "Card"} ending ${row?.card_last4 ?? "????"}`;
  const chosen = retail ?? (allowDuesCard ? dues : undefined);
  if (!chosen) return dues ? { needsDuesConfirm: label(dues) } : { error: "This member has no card on file." };
  const purpose = retail ? "retail" : "dues";

  const checked = await savePracticeSale(staff, { ...request, validateOnly: true });
  if ("error" in checked) return checked;
  if (!("totalCents" in checked)) return { error: "Couldn't check the sale. Try again." };
  if (checked.totalCents < 50) return { error: "Card payments need a total of at least $0.50." };
  const fee = applicationFeeCents(checked.totalCents);
  const { data: row, error } = await admin
    .from("pos_card_payments")
    .insert({
      organization_id: staff.organizationId,
      staff_id: staff.id,
      stripe_account_id: account.stripeAccountId,
      livemode: account.livemode,
      stripe_customer_id: chosen.stripe_customer_id,
      stripe_payment_method_id: chosen.stripe_payment_method_id,
      on_file_purpose: purpose,
      amount_cents: checked.totalCents,
      application_fee_cents: fee,
      sale_request: request,
    })
    .select("id")
    .single();
  if (error || !row) return { error: "Couldn't start the payment. Try again." };
  try {
    const intent = await getStripe().paymentIntents.create(
      {
        amount: checked.totalCents,
        currency: "usd",
        customer: chosen.stripe_customer_id as string,
        payment_method: chosen.stripe_payment_method_id as string,
        off_session: true,
        confirm: true,
        description: `SynqIQ checkout (card on file)${request.clientName ? ` · ${request.clientName}` : ""}`,
        metadata: { synqiq_payment_id: row.id as string, synqiq_organization_id: staff.organizationId, synqiq_card_on_file: purpose },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { stripeAccount: account.stripeAccountId, idempotencyKey: `synqiq-pos-on-file-${row.id}` },
    );
    await admin.from("pos_card_payments").update({ payment_intent_id: intent.id }).eq("id", row.id);
  } catch (stripeError) {
    const declined = (stripeError as { type?: string; message?: string }).type === "StripeCardError";
    await admin
      .from("pos_card_payments")
      .update({ status: "cancelled", last_error: declined ? "Card on file declined" : "Couldn't create the payment" })
      .eq("id", row.id);
    if (!declined) console.error("[payments/checkout] card on file failed:", stripeError);
    return {
      error: declined
        ? `The ${purpose === "retail" ? "retail" : "dues"} card on file (${label(chosen)}) was declined. Ask for another card.`
        : "Couldn't charge the card on file. Try again.",
    };
  }
  return finishCardPayment(row.id as string, staff.organizationId);
}

// Refund a card sale in full (when it's voided). Idempotent per sale.
export async function refundCardSale(
  admin: Admin,
  organizationId: string,
  saleId: string,
): Promise<{ error: string } | { refunded: number }> {
  const { data: row } = await admin
    .from("pos_card_payments")
    .select("id, stripe_account_id, payment_intent_id, amount_cents, refunded_cents")
    .eq("sale_id", saleId)
    .eq("organization_id", organizationId)
    .eq("status", "completed")
    .maybeSingle();
  if (!row) return { refunded: 0 }; // not a card sale
  const remaining = Number(row.amount_cents) - Number(row.refunded_cents);
  if (remaining <= 0) return { refunded: 0 };
  try {
    await getStripe().refunds.create(
      // A voided sale returns SynqIQ's fee to the studio too.
      {
        payment_intent: row.payment_intent_id as string,
        amount: remaining,
        refund_application_fee: true,
        metadata: { synqiq_sale_id: saleId },
      },
      { stripeAccount: row.stripe_account_id as string, idempotencyKey: `synqiq-void-refund-${saleId}` },
    );
  } catch (stripeError) {
    console.error("[payments/checkout] refund failed:", stripeError);
    return { error: "Stripe couldn't refund the card. The sale was not voided." };
  }
  await admin
    .from("pos_card_payments")
    .update({ refunded_cents: Number(row.amount_cents) })
    .eq("id", row.id);
  return { refunded: remaining };
}

// Webhook: a payment failed or was cancelled. Nothing was saved, so this only
// records why (the checkout screen shows Stripe's message directly).
export async function noteCardPaymentFailure(paymentId: string, accountId: string, message: string) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("pos_card_payments")
    .update({ last_error: message.slice(0, 300) })
    .eq("id", paymentId)
    .eq("stripe_account_id", accountId)
    .eq("status", "pending");
}

async function savedSale(admin: Admin, saleId: string, livemode: boolean): Promise<FinishResult> {
  const { data } = await admin.from("pos_sales").select("sale_number").eq("id", saleId).maybeSingle();
  return { saleId, saleNumber: Number(data?.sale_number ?? 0), livemode };
}

async function markAttention(admin: Admin, id: string, message: string): Promise<FinishResult> {
  console.error("[payments/checkout] payment needs attention:", id, message);
  await admin
    .from("pos_card_payments")
    .update({ status: "needs_attention", last_error: message.slice(0, 300) })
    .eq("id", id);
  return { error: `The card was charged but the sale couldn't be saved (${message}). Ask a Club Admin to check it.`, paid: true };
}

function statusMessage(status: string): string {
  if (status === "finalizing") return "This payment is already being saved.";
  if (status === "needs_attention") return "The card was charged but the sale needs a Club Admin to check it.";
  return "This payment was cancelled.";
}
