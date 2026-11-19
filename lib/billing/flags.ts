import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { billingFlag, cardExpiry, type BillingFlag, type CardExpiry } from "@/lib/billing/renewals";

// Red / yellow billing flags for members, from their SynqIQ payment schedules
// (lib/billing/renewals.ts): red = a payment failed every retry and booking is
// frozen; yellow = the card on file expires within a month.

export type MemberBilling = {
  flag: BillingFlag;
  frozen: boolean;
  card: (CardExpiry & { brand: string | null; last4: string | null }) | null;
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function memberBillingFlags(
  admin: Admin,
  organizationId: string,
  clientIds: string[],
  timezone = "America/Chicago",
): Promise<Map<string, MemberBilling>> {
  const out = new Map<string, MemberBilling>();
  if (clientIds.length === 0) return out;
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const { data } = await admin
    .from("member_billing_schedules")
    .select("mindbody_client_id, billing_state, card_brand, card_last4, card_exp_month, card_exp_year")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("mindbody_client_id", clientIds.slice(0, 1000));
  for (const row of data ?? []) {
    const clientId = row.mindbody_client_id as string;
    const frozen = row.billing_state === "frozen";
    const card =
      row.card_exp_month && row.card_exp_year
        ? {
            ...cardExpiry(Number(row.card_exp_month), Number(row.card_exp_year), today),
            brand: (row.card_brand as string | null) ?? null,
            last4: (row.card_last4 as string | null) ?? null,
          }
        : null;
    const previous = out.get(clientId);
    const merged = {
      frozen: frozen || Boolean(previous?.frozen),
      // The card closest to expiring.
      card: previous?.card && (!card || previous.card.expiresOn < card.expiresOn) ? previous.card : card,
    };
    out.set(clientId, { ...merged, flag: billingFlag(merged) });
  }
  return out;
}

export async function billingFrozen(organizationId: string, clientId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("member_billing_schedules")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId)
    .eq("status", "active")
    .eq("billing_state", "frozen")
    .limit(1);
  return Boolean(data?.length);
}

export const FROZEN_MESSAGE = "Booking is paused: the monthly payment didn't go through. Please update your card at the front desk.";
