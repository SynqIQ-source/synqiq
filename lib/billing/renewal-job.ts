import { DateTime } from "luxon";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripeLivemode } from "@/lib/payments/connect";
import { applicationFeeCents } from "@/lib/payments/checkout";
import { afterDecline, datesToCharge } from "@/lib/billing/renewals";
import { recordRenewalSale } from "@/lib/billing/renewal-sale";
import { emailDecline } from "@/lib/billing/notify";

// The nightly membership renewal run (rules in lib/billing/renewals.ts).
// For each schedule with a saved card it charges the billing dates that are
// due, off-session, as a direct charge on the studio's Stripe account, and
// retries declined ones on their retry day. A charge row is claimed before
// Stripe is called (unique per schedule + billing date, and the Stripe
// idempotency key is per charge + attempt), so a re-run or two overlapping
// runs can't charge anyone twice.
//
// A membership on hold (billing_state frozen: the last retry failed) is not
// charged again: each billing date that comes up while it's on hold is
// recorded as skipped (status cancelled) and never tried. Paying the unpaid
// month (new card, front desk, or Retry on Member Billing) lifts the hold
// and autopay resumes from the next billing date.
//
// Live charging needs SYNQIQ_RENEWALS_LIVE=true on top of the Connect live
// switch; until then only test-mode (sandbox) schedules are charged.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export function renewalsMayCharge(livemode: boolean): boolean {
  if (livemode !== stripeLivemode()) return false;
  if (!livemode) return true;
  return process.env.STRIPE_CONNECT_LIVE === "true" && process.env.SYNQIQ_RENEWALS_LIVE === "true";
}

type Schedule = {
  id: string;
  organization_id: string;
  mindbody_client_id: string | null;
  client_name: string | null;
  name: string;
  status: string;
  first_bill_date: string;
  autopay_count: number | null;
  auto_renews: boolean;
  recurring_subtotal_cents: number;
  recurring_tax_cents: number;
  recurring_total_cents: number;
  stripe_account_id: string;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
  billing_state?: string | null;
};

type Charge = {
  id: string;
  schedule_id: string;
  due_date: string;
  total_cents: number;
  attempts: number;
  status: string;
  retry_from: string | null;
  retry_base_attempts: number;
};

const CHARGE_FIELDS = "id, schedule_id, due_date, total_cents, attempts, status, retry_from, retry_base_attempts";

export type RenewalSummary = { due: number; paid: number; declined: number; frozen: number; pending: number; errors: number; held: number };

export async function runRenewals(organizationId: string, options: { now?: Date } = {}): Promise<RenewalSummary> {
  const admin = createSupabaseAdminClient();
  const summary: RenewalSummary = { due: 0, paid: 0, declined: 0, frozen: 0, pending: 0, errors: 0, held: 0 };
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.fromJSDate(options.now ?? new Date())
    .setZone(zone)
    .toISODate()!;

  // Which of the studio's Stripe accounts this server may charge on.
  const { data: accounts } = await admin
    .from("stripe_connected_accounts")
    .select("stripe_account_id, livemode")
    .eq("organization_id", organizationId);
  const chargeable = new Map(
    (accounts ?? [])
      .filter((row) => renewalsMayCharge(Boolean(row.livemode)))
      .map((row) => [row.stripe_account_id as string, Boolean(row.livemode)]),
  );
  if (chargeable.size === 0) return summary;

  const { data: rows } = await admin
    .from("member_billing_schedules")
    .select(
      "id, organization_id, mindbody_client_id, client_name, name, status, first_bill_date, autopay_count, auto_renews, recurring_subtotal_cents, recurring_tax_cents, recurring_total_cents, stripe_account_id, stripe_customer_id, stripe_payment_method_id, billing_state",
    )
    .eq("organization_id", organizationId)
    .in("status", ["active", "practice"])
    .in("stripe_account_id", [...chargeable.keys()])
    .not("stripe_customer_id", "is", null)
    .not("stripe_payment_method_id", "is", null)
    .limit(5000);
  // Live accounts only bill live (active) schedules; test accounts bill the
  // practice schedules their test payments created.
  const schedules = ((rows ?? []) as Schedule[]).filter((row) =>
    chargeable.get(row.stripe_account_id) ? row.status === "active" : row.status === "practice",
  );
  const scheduleBy = new Map(schedules.map((row) => [row.id, row]));

  // New billing dates: claim a row for each (the unique key stops repeats).
  for (const schedule of schedules) {
    const onHold = schedule.billing_state === "frozen";
    for (const due of datesToCharge(schedule.first_bill_date, schedule.autopay_count, schedule.auto_renews, today)) {
      if (onHold) {
        // On hold: this month is skipped, never charged (see the header).
        const { data: skipped } = await admin
          .from("membership_charges")
          .upsert(
            {
              organization_id: organizationId,
              schedule_id: schedule.id,
              mindbody_client_id: schedule.mindbody_client_id,
              due_date: due,
              subtotal_cents: schedule.recurring_subtotal_cents,
              tax_cents: schedule.recurring_tax_cents,
              total_cents: schedule.recurring_total_cents,
              status: "cancelled",
              livemode: chargeable.get(schedule.stripe_account_id) ?? false,
              stripe_account_id: schedule.stripe_account_id,
            },
            { onConflict: "schedule_id,due_date", ignoreDuplicates: true },
          )
          .select("id");
        summary.held += skipped?.length ?? 0;
        continue;
      }
      const { data: claimed } = await admin
        .from("membership_charges")
        .upsert(
          {
            organization_id: organizationId,
            schedule_id: schedule.id,
            mindbody_client_id: schedule.mindbody_client_id,
            due_date: due,
            subtotal_cents: schedule.recurring_subtotal_cents,
            tax_cents: schedule.recurring_tax_cents,
            total_cents: schedule.recurring_total_cents,
            status: "processing",
            livemode: chargeable.get(schedule.stripe_account_id) ?? false,
            stripe_account_id: schedule.stripe_account_id,
          },
          { onConflict: "schedule_id,due_date", ignoreDuplicates: true },
        )
        .select(CHARGE_FIELDS);
      for (const charge of (claimed ?? []) as Charge[]) {
        summary.due += 1;
        tally(summary, await attempt(admin, schedule, charge, today));
      }
    }
  }

  // Retries due today (and charges a Stripe outage put back): claim each by
  // moving it to processing.
  const { data: retries } = await admin
    .from("membership_charges")
    .select(CHARGE_FIELDS)
    .eq("organization_id", organizationId)
    .in("status", ["declined", "scheduled"])
    .lte("next_attempt_on", today)
    .limit(1000);
  for (const charge of (retries ?? []) as Charge[]) {
    const schedule = scheduleBy.get(charge.schedule_id);
    if (!schedule) continue;
    const { data: claimed } = await admin
      .from("membership_charges")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", charge.id)
      .eq("status", charge.status)
      .select("id");
    if (!claimed?.length) continue;
    summary.due += 1;
    tally(summary, await attempt(admin, schedule, charge, today));
  }
  return summary;
}

export type Outcome = "paid" | "declined" | "frozen" | "pending" | "error";

function tally(summary: RenewalSummary, outcome: Outcome) {
  if (outcome === "error") summary.errors += 1;
  else summary[outcome] += 1;
}

async function attempt(admin: Admin, schedule: Schedule, charge: Charge, today: string): Promise<Outcome> {
  const attemptNumber = charge.attempts + 1;
  const amount = charge.total_cents;
  const fee = applicationFeeCents(amount);
  let intent: Stripe.PaymentIntent | null = null;
  let decline: string | null = null;
  try {
    intent = await getStripe().paymentIntents.create(
      {
        amount,
        currency: "usd",
        customer: schedule.stripe_customer_id,
        payment_method: schedule.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: `${schedule.name} · ${DateTime.fromISO(charge.due_date).toFormat("LLL yyyy")}${schedule.client_name ? ` · ${schedule.client_name}` : ""}`,
        metadata: {
          synqiq_membership_charge_id: charge.id,
          synqiq_schedule_id: schedule.id,
          synqiq_organization_id: schedule.organization_id,
          due_date: charge.due_date,
        },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { stripeAccount: schedule.stripe_account_id, idempotencyKey: `synqiq-renewal-${charge.id}-${attemptNumber}` },
    );
  } catch (error) {
    const stripeError = error as {
      type?: string;
      code?: string;
      decline_code?: string;
      message?: string;
      payment_intent?: Stripe.PaymentIntent;
    };
    if (stripeError.type === "StripeCardError") {
      decline = stripeError.decline_code ?? stripeError.code ?? "card_declined";
      intent = stripeError.payment_intent ?? null;
    } else {
      // Not a decline (network, configuration): put it back for the next run.
      console.error("[billing/renewals] charge failed:", charge.id, stripeError.message);
      await admin
        .from("membership_charges")
        .update({
          status: charge.attempts ? "declined" : "scheduled",
          next_attempt_on: DateTime.fromISO(today).plus({ days: 1 }).toISODate(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", charge.id);
      return "error";
    }
  }

  if (intent?.status === "succeeded") {
    await markPaid(admin, charge.id, schedule.id, intent.id, attemptNumber);
    return "paid";
  }
  if (!decline && intent && (intent.status === "processing" || intent.status === "requires_capture")) {
    await admin
      .from("membership_charges")
      .update({ payment_intent_id: intent.id, attempts: attemptNumber, updated_at: new Date().toISOString() })
      .eq("id", charge.id);
    return "pending"; // the webhook finishes it
  }
  // Declined, or the bank wants the member present (authentication): both
  // follow the retry schedule; the member updates their card in the meantime.
  return recordDecline(admin, charge, schedule.id, attemptNumber, decline ?? intent?.status ?? "declined", intent?.id ?? null);
}

export async function markPaid(admin: Admin, chargeId: string, scheduleId: string, paymentIntentId: string, attempts?: number) {
  const now = new Date().toISOString();
  const { data: updated } = await admin
    .from("membership_charges")
    .update({
      status: "paid",
      payment_intent_id: paymentIntentId,
      paid_at: now,
      next_attempt_on: null,
      ...(attempts ? { attempts } : {}),
      updated_at: now,
    })
    .eq("id", chargeId)
    .neq("status", "paid")
    .select("id");
  // The month's dues as a sale (for the reports and the member's purchases).
  if (updated?.length) await recordRenewalSale(admin, chargeId);
  // Booking back on unless another month is still unpaid.
  const { data: open } = await admin
    .from("membership_charges")
    .select("id")
    .eq("schedule_id", scheduleId)
    .in("status", ["declined", "failed"])
    .limit(1);
  if (!open?.length)
    await admin.from("member_billing_schedules").update({ billing_state: "current", frozen_at: null }).eq("id", scheduleId);
}

// A declined attempt: booking is paused from the first decline (past due),
// retries follow 3, 6 and 10 days after the billing date (or after the date a
// Club Admin moved it to), and after the last one the membership is frozen.
// The member is emailed at the first decline and when it's frozen.
export async function recordDecline(
  admin: Admin,
  charge: { id: string; due_date: string; retry_from?: string | null; retry_base_attempts?: number | null },
  scheduleId: string,
  attempts: number,
  reason: string,
  paymentIntentId: string | null,
): Promise<"declined" | "frozen"> {
  const base = charge.retry_from ?? charge.due_date;
  const next = afterDecline(base, Math.max(1, attempts - Number(charge.retry_base_attempts ?? 0)));
  const now = new Date().toISOString();
  const frozen = "freeze" in next;
  await admin
    .from("membership_charges")
    .update({
      status: frozen ? "failed" : "declined",
      attempts,
      next_attempt_on: frozen ? null : next.retryOn,
      last_decline: reason.slice(0, 120),
      payment_intent_id: paymentIntentId,
      updated_at: now,
    })
    .eq("id", charge.id);
  await admin
    .from("member_billing_schedules")
    .update(frozen ? { billing_state: "frozen", frozen_at: now } : { billing_state: "past_due" })
    .eq("id", scheduleId)
    .neq("billing_state", "frozen");
  try {
    await emailDecline(admin, charge.id, frozen ? null : next.retryOn);
  } catch (error) {
    console.error("[billing/renewals] decline email failed:", charge.id, error);
  }
  return frozen ? "frozen" : "declined";
}

const SCHEDULE_FIELDS =
  "id, organization_id, mindbody_client_id, client_name, name, status, first_bill_date, autopay_count, auto_renews, recurring_subtotal_cents, recurring_tax_cents, recurring_total_cents, stripe_account_id, stripe_customer_id, stripe_payment_method_id";

async function todayFor(admin: Admin, organizationId: string) {
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  return DateTime.now()
    .setZone((org?.timezone as string | null) ?? "America/Chicago")
    .toISODate()!;
}

// Club Admin, from Member Billing: try a declined, frozen or scheduled charge
// right now (e.g. after the member's bank cleared it).
export async function retryChargeNow(organizationId: string, chargeId: string): Promise<{ error: string } | { outcome: Outcome }> {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("membership_charges")
    .select(CHARGE_FIELDS)
    .eq("id", chargeId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!row) return { error: "Charge not found." };
  const charge = row as unknown as Charge;
  if (!["declined", "failed", "scheduled"].includes(charge.status)) return { error: "This charge isn't waiting to be paid." };
  const { data: scheduleRow } = await admin
    .from("member_billing_schedules")
    .select(SCHEDULE_FIELDS)
    .eq("id", charge.schedule_id)
    .maybeSingle();
  const schedule = scheduleRow as Schedule | null;
  if (!schedule?.stripe_customer_id || !schedule.stripe_payment_method_id) return { error: "There's no card on file." };
  const { data: account } = await admin
    .from("stripe_connected_accounts")
    .select("livemode")
    .eq("stripe_account_id", schedule.stripe_account_id)
    .maybeSingle();
  if (!account || !renewalsMayCharge(Boolean(account.livemode)))
    return { error: "Renewal charging isn't switched on for this studio yet." };
  // A manual try doesn't use up one of the automatic retries: if it's declined
  // the next automatic retry stays on the same day.
  const manual = { ...charge, retry_base_attempts: Number(charge.retry_base_attempts ?? 0) + 1 };
  const { data: claimed } = await admin
    .from("membership_charges")
    .update({ status: "processing", retry_base_attempts: manual.retry_base_attempts, updated_at: new Date().toISOString() })
    .eq("id", charge.id)
    .eq("status", charge.status)
    .select("id");
  if (!claimed?.length) return { error: "This charge is already being processed." };
  return { outcome: await attempt(admin, schedule, manual, await todayFor(admin, organizationId)) };
}

// Club Admin: move one billing date (a declined charge's next try, or an
// upcoming billing date) to another day, once, without changing the
// schedule. Retries then count from the new date.
export async function moveChargeDate(
  organizationId: string,
  staffId: string,
  target: { chargeId: string } | { scheduleId: string; dueDate: string },
  newDate: string,
): Promise<{ error: string } | { ok: true }> {
  const admin = createSupabaseAdminClient();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: "Pick a date." };
  const today = await todayFor(admin, organizationId);
  if (newDate < today) return { error: "Pick today or a later date." };
  if (newDate > DateTime.fromISO(today).plus({ days: 90 }).toISODate()!) return { error: "Pick a date within 90 days." };
  const now = new Date().toISOString();
  const moved = { next_attempt_on: newDate, retry_from: newDate, moved_by_staff_id: staffId, moved_at: now, updated_at: now };

  if ("chargeId" in target) {
    const { data: charge } = await admin
      .from("membership_charges")
      .select("id, status, attempts")
      .eq("id", target.chargeId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!charge) return { error: "Charge not found." };
    const status = charge.status as string;
    if (!["declined", "failed", "scheduled"].includes(status)) return { error: "This charge isn't waiting to be paid." };
    // A frozen charge goes back on the schedule; its retries start over from the new date.
    const { data: updated } = await admin
      .from("membership_charges")
      .update({ ...moved, status: status === "failed" ? "declined" : status, retry_base_attempts: Number(charge.attempts) })
      .eq("id", charge.id)
      .eq("status", status)
      .select("id");
    return updated?.length ? { ok: true } : { error: "This charge changed. Refresh and try again." };
  }

  // An upcoming billing date: hold it as a scheduled charge on the new day.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target.dueDate) || target.dueDate < today) return { error: "That billing date has passed." };
  const { data: schedule } = await admin
    .from("member_billing_schedules")
    .select("id, mindbody_client_id, recurring_subtotal_cents, recurring_tax_cents, recurring_total_cents, stripe_account_id")
    .eq("id", target.scheduleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!schedule) return { error: "Schedule not found." };
  const { data: existing } = await admin
    .from("membership_charges")
    .select("id, status")
    .eq("schedule_id", schedule.id)
    .eq("due_date", target.dueDate)
    .maybeSingle();
  if (existing) {
    if (existing.status !== "scheduled") return { error: "This month has already been charged." };
    await admin.from("membership_charges").update(moved).eq("id", existing.id);
    return { ok: true };
  }
  const { data: account } = await admin
    .from("stripe_connected_accounts")
    .select("livemode")
    .eq("stripe_account_id", (schedule.stripe_account_id as string | null) ?? "")
    .maybeSingle();
  const { error } = await admin.from("membership_charges").insert({
    organization_id: organizationId,
    schedule_id: schedule.id,
    mindbody_client_id: schedule.mindbody_client_id,
    due_date: target.dueDate,
    subtotal_cents: schedule.recurring_subtotal_cents,
    tax_cents: schedule.recurring_tax_cents,
    total_cents: schedule.recurring_total_cents,
    status: "scheduled",
    livemode: Boolean(account?.livemode),
    stripe_account_id: schedule.stripe_account_id,
    ...moved,
  });
  return error ? { error: "Couldn't move the date. Try again." } : { ok: true };
}

// Payments webhook: a renewal Stripe finished after the nightly run (e.g. it
// was still processing). The intent is re-read from Stripe, not trusted.
export async function finishRenewalFromEvent(event: Stripe.PaymentIntent, accountId: string) {
  const admin = createSupabaseAdminClient();
  const chargeId = event.metadata?.synqiq_membership_charge_id;
  if (!chargeId) return;
  const { data: charge } = await admin
    .from("membership_charges")
    .select("id, schedule_id, due_date, attempts, status, stripe_account_id, total_cents, retry_from, retry_base_attempts")
    .eq("id", chargeId)
    .maybeSingle();
  if (!charge || charge.stripe_account_id !== accountId || charge.status === "paid") return;
  const intent = await getStripe().paymentIntents.retrieve(event.id, {}, { stripeAccount: accountId });
  if (intent.metadata?.synqiq_membership_charge_id !== chargeId) return;
  if (intent.status === "succeeded" && intent.amount_received === Number(charge.total_cents)) {
    await markPaid(admin, charge.id as string, charge.schedule_id as string, intent.id);
  } else if (intent.status === "requires_payment_method" && charge.status === "processing") {
    await recordDecline(
      admin,
      {
        id: charge.id as string,
        due_date: charge.due_date as string,
        retry_from: charge.retry_from as string | null,
        retry_base_attempts: Number(charge.retry_base_attempts),
      },
      charge.schedule_id as string,
      Math.max(1, Number(charge.attempts)),
      intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? "declined",
      intent.id,
    );
  }
}
