import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients } from "@/lib/email/send";
import { createCardLink } from "@/lib/billing/card-links";
import { cardExpiry, cardNoticeDue } from "@/lib/billing/renewals";
import { defaultKit, emailButton, renderStudioEmail, type EmailKit } from "@/lib/email/studio-templates";
import { loadEmailKit, studioFrom } from "@/lib/email/studio-kit";

// Emails to members about their monthly payment (Adam, 2026-11-19): when a
// payment is first declined (booking paused, the next retry date) and when the
// last retry fails. Only live charges email anyone; test-mode charges never do.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const longDay = (iso: string) => DateTime.fromISO(iso).toFormat("cccc, LLLL d");

export type DeclineEmailInput = {
  studioName: string;
  firstName: string;
  membership: string;
  amountCents: number;
  card: string | null; // "Visa ending 4242"
  retryOn: string | null; // null = no more retries
  updateUrl?: string | null; // one-time "update your card" link
};

const LINK_NOTE = "This secure link works for 7 days. Your card goes straight to our payment processor, Stripe.";

// The studio's wording and header/footer (Admin > Email > Templates); the
// defaults when no kit is passed.
export function declinedPaymentEmail(input: DeclineEmailInput, kit: EmailKit = defaultKit(input.studioName)) {
  const final = input.retryOn === null;
  return renderStudioEmail(
    final ? "payment_on_hold" : "payment_declined",
    {
      studio: input.studioName,
      first_name: input.firstName,
      membership: input.membership,
      amount: money(input.amountCents),
      card_note: input.card ? ` (${input.card})` : "",
      retry_date: input.retryOn ? longDay(input.retryOn) : "",
    },
    kit,
    {
      action: input.updateUrl
        ? emailButton(input.updateUrl, final ? "Update your card and pay" : "Update your card", kit.branding.color, LINK_NOTE)
        : "",
    },
  );
}

// Staff sent a link, or the card on file is about to expire (first notice a
// month before, second 15 days later).
export function cardLinkEmail(
  input: {
    studioName: string;
    firstName: string;
    reason: "staff" | "expiring";
    card: string | null;
    expires: string | null; // "December 2026"
    second?: boolean;
    updateUrl: string;
  },
  kit: EmailKit = defaultKit(input.studioName),
) {
  const key = input.reason === "staff" ? "card_link" : input.second ? "card_expiring_reminder" : "card_expiring";
  return renderStudioEmail(
    key,
    {
      studio: input.studioName,
      first_name: input.firstName,
      card_note: input.card ? ` (${input.card})` : "",
      expires: input.expires ?? "this month",
    },
    kit,
    { action: emailButton(input.updateUrl, "Update your card", kit.branding.color, LINK_NOTE) },
  );
}

export const cardLabel = (brand: string | null | undefined, last4: string | null | undefined) =>
  last4 ? `${brand ? brand[0].toUpperCase() + brand.slice(1) : "Card"} ending ${last4}` : null;

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
  const [{ data: schedule }, kit, contact] = await Promise.all([
    admin.from("member_billing_schedules").select("name, card_brand, card_last4").eq("id", charge.schedule_id).maybeSingle(),
    loadEmailKit(admin, charge.organization_id as string),
    memberEmail(admin, charge.organization_id as string, charge.mindbody_client_id as string),
  ]);
  if (!contact.email) return false;
  const studioName = kit.branding.studioName;
  const updateUrl = await createCardLink(admin, charge.organization_id as string, charge.mindbody_client_id as string, "declined", null);
  await sendEmailToRecipients([{ email: contact.email }], {
    from: studioFrom(studioName),
    ...declinedPaymentEmail(
      {
        studioName,
        firstName: contact.firstName,
        membership: (schedule?.name as string | null) ?? "membership",
        amountCents: Number(charge.total_cents),
        card: cardLabel(schedule?.card_brand as string | null, schedule?.card_last4 as string | null),
        retryOn,
        updateUrl,
      },
      kit,
    ),
  });
  await admin
    .from("membership_charges")
    .update(final ? { frozen_emailed_at: new Date().toISOString() } : { decline_emailed_at: new Date().toISOString() })
    .eq("id", chargeId);
  return true;
}

// Staff: email a member a link to update their card.
export async function sendCardLink(
  organizationId: string,
  clientId: string,
  staffId: string,
): Promise<{ error: string } | { email: string }> {
  const admin = createSupabaseAdminClient();
  const [contact, kit, { data: card }] = await Promise.all([
    memberEmail(admin, organizationId, clientId),
    loadEmailKit(admin, organizationId),
    admin
      .from("member_cards")
      .select("card_brand, card_last4")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .limit(1)
      .maybeSingle(),
  ]);
  if (!contact.email) return { error: "This member has no email address on file." };
  const studioName = kit.branding.studioName;
  const updateUrl = await createCardLink(admin, organizationId, clientId, "staff", staffId);
  await sendEmailToRecipients([{ email: contact.email }], {
    from: studioFrom(studioName),
    ...cardLinkEmail(
      {
        studioName,
        firstName: contact.firstName,
        reason: "staff",
        card: cardLabel(card?.card_brand as string | null, card?.card_last4 as string | null),
        expires: null,
        updateUrl,
      },
      kit,
    ),
  });
  return { email: contact.email };
}

// Nightly: expiring-card emails for live membership schedules, one per member
// (first when the card turns yellow, second 15 days later).
export async function sendExpiringCardNotices(organizationId: string, today: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data: schedules } = await admin
    .from("member_billing_schedules")
    .select("id, mindbody_client_id, card_brand, card_last4, card_exp_month, card_exp_year")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .not("card_exp_month", "is", null)
    .not("card_exp_year", "is", null);
  if (!schedules?.length) return 0;
  const { data: notices } = await admin
    .from("card_expiry_notices")
    .select("schedule_id, card_exp_month, card_exp_year, notice, sent_at")
    .eq("organization_id", organizationId);
  const kit = await loadEmailKit(admin, organizationId);
  const studioName = kit.branding.studioName;
  const byClient = new Map<string, typeof schedules>();
  for (const row of schedules)
    byClient.set(row.mindbody_client_id as string, [...(byClient.get(row.mindbody_client_id as string) ?? []), row]);
  let sent = 0;
  for (const [clientId, rows] of byClient) {
    const first = rows[0];
    const month = Number(first.card_exp_month);
    const year = Number(first.card_exp_year);
    const expiry = cardExpiry(month, year, today);
    const mine = (notices ?? []).filter(
      (row) => rows.some((s) => s.id === row.schedule_id) && row.card_exp_month === month && row.card_exp_year === year,
    );
    const firstSent = mine.find((row) => row.notice === "first");
    const due = cardNoticeDue(
      expiry,
      { first: Boolean(firstSent), second: mine.some((row) => row.notice === "second") },
      today,
      firstSent ? (firstSent.sent_at as string).slice(0, 10) : null,
    );
    if (!due) continue;
    const contact = await memberEmail(admin, organizationId, clientId);
    if (contact.email) {
      const updateUrl = await createCardLink(admin, organizationId, clientId, "expiring", null);
      await sendEmailToRecipients([{ email: contact.email }], {
        from: studioFrom(studioName),
        ...cardLinkEmail(
          {
            studioName,
            firstName: contact.firstName,
            reason: "expiring",
            card: cardLabel(first.card_brand as string | null, first.card_last4 as string | null),
            expires: DateTime.fromObject({ year, month, day: 1 }).toFormat("LLLL yyyy"),
            second: due === "second",
            updateUrl,
          },
          kit,
        ),
      });
      sent += 1;
    }
    // Recorded even without an email address, so the list shows it was due.
    await admin.from("card_expiry_notices").upsert(
      rows.map((row) => ({
        organization_id: organizationId,
        schedule_id: row.id,
        card_exp_month: month,
        card_exp_year: year,
        notice: due,
      })),
      { onConflict: "schedule_id,card_exp_month,card_exp_year,notice", ignoreDuplicates: true },
    );
  }
  return sent;
}
