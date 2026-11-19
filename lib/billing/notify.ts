import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients } from "@/lib/email/send";

// Emails to members about their monthly payment (Adam, 2026-11-19): when a
// payment is first declined (booking paused, the next retry date) and when the
// last retry fails. Only live charges email anyone; test-mode charges never do.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const longDay = (iso: string) => DateTime.fromISO(iso).toFormat("cccc, LLLL d");

export type DeclineEmailInput = {
  studioName: string;
  firstName: string;
  membership: string;
  amountCents: number;
  card: string | null; // "Visa ending 4242"
  retryOn: string | null; // null = no more retries
};

export function declinedPaymentEmail(input: DeclineEmailInput) {
  const card = input.card ? ` (${escapeHtml(input.card)})` : "";
  const final = input.retryOn === null;
  const opening = final
    ? `We weren't able to collect your <strong>${escapeHtml(input.membership)}</strong> payment of ${money(input.amountCents)} after several tries, so your membership is on hold.`
    : `Your <strong>${escapeHtml(input.membership)}</strong> payment of ${money(input.amountCents)} was declined by your card${card}.`;
  const retry = final ? "" : ` We'll try your card again on <strong>${escapeHtml(longDay(input.retryOn!))}</strong>.`;
  return {
    subject: final ? `Your ${input.studioName} membership is on hold` : `Your ${input.studioName} membership payment didn't go through`,
    html: `
      <p>Hi ${escapeHtml(input.firstName || "there")},</p>
      <p>${opening}</p>
      <p>Class and lane booking is paused until the payment is made.${retry}</p>
      <p>If your card has changed or was replaced, please stop by or call the front desk and we'll update it and get you booking again.</p>
      <p>Thank you,<br>${escapeHtml(input.studioName)}</p>
    `,
  };
}

// The member's email: their SynqIQ contact-detail edit if any, else Mindbody's.
export async function memberEmail(admin: Admin, organizationId: string, clientId: string) {
  const [{ data: client }, { data: personal }] = await Promise.all([
    admin
      .from("clients")
      .select("first_name, email")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .maybeSingle(),
    admin.from("member_personal").select("edits").eq("organization_id", organizationId).eq("mindbody_client_id", clientId).maybeSingle(),
  ]);
  const edited = (personal?.edits as { email?: string | null } | null)?.email;
  const email = edited !== undefined ? edited : ((client?.email as string | null) ?? null);
  return { email: email?.trim() || null, firstName: (client?.first_name as string | null) ?? "" };
}

// Sends the decline email (first decline) or the on-hold email (last retry
// failed) once per charge. Returns whether an email went out.
export async function emailDecline(admin: Admin, chargeId: string, retryOn: string | null): Promise<boolean> {
  const { data: charge } = await admin
    .from("membership_charges")
    .select("id, organization_id, schedule_id, mindbody_client_id, total_cents, livemode, decline_emailed_at, frozen_emailed_at")
    .eq("id", chargeId)
    .maybeSingle();
  if (!charge?.livemode || !charge.mindbody_client_id) return false;
  const final = retryOn === null;
  if (final ? charge.frozen_emailed_at : charge.decline_emailed_at) return false;
  const [{ data: schedule }, { data: org }, contact] = await Promise.all([
    admin.from("member_billing_schedules").select("name, card_brand, card_last4").eq("id", charge.schedule_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", charge.organization_id).maybeSingle(),
    memberEmail(admin, charge.organization_id as string, charge.mindbody_client_id as string),
  ]);
  if (!contact.email) return false;
  const studioName = (org?.name as string | null) ?? "Your studio";
  const brand = (schedule?.card_brand as string | null) ?? null;
  await sendEmailToRecipients([{ email: contact.email }], {
    from: `${studioName.replace(/[<>"]/g, "")} <notifications@synqiq.co>`,
    ...declinedPaymentEmail({
      studioName,
      firstName: contact.firstName,
      membership: (schedule?.name as string | null) ?? "membership",
      amountCents: Number(charge.total_cents),
      card: schedule?.card_last4 ? `${brand ? brand[0].toUpperCase() + brand.slice(1) : "Card"} ending ${schedule.card_last4}` : null,
      retryOn,
    }),
  });
  await admin
    .from("membership_charges")
    .update(final ? { frozen_emailed_at: new Date().toISOString() } : { decline_emailed_at: new Date().toISOString() })
    .eq("id", chargeId);
  return true;
}
