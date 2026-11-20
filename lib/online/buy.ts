import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizePhone, cleanText } from "@/lib/crm/normalize";
import { cardPaymentsReady, onlineActor, startCardPayment, type CardSaleRequest } from "@/lib/payments/checkout";
import { savePracticeSale } from "@/lib/pos/sales";
import { stripeLivemode } from "@/lib/payments/connect";
import type { AgreementSignatureRequest } from "@/lib/agreements/sale";

// Buy online / in the member app (Adam, 2026-11-19). Everything goes through
// the same sale code as the front desk (prices, tax, package billing,
// agreements, member IDs), as an "online" sale with no staff member.
//
// Who's buying must be a real person on file:
//   - signed in to the member app -> that member;
//   - otherwise name + email + phone: matched to an existing guest or lead,
//     or a new lead is created. An email/phone that belongs to a Mindbody
//     client (a current or past member) must sign in instead, so nobody can
//     buy (and sign an agreement) in someone else's name.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type OnlineItem = {
  id: string;
  name: string;
  kind: string;
  priceCents: number;
  sessions: number | null;
  membersOnly: boolean;
  monthly: boolean;
};

export async function onlineItems(admin: Admin, organizationId: string): Promise<OnlineItem[]> {
  const { data } = await admin
    .from("pos_items")
    .select("id, name, kind, price_cents, sessions, members_only, package_parts, sort")
    .eq("organization_id", organizationId)
    .eq("sell_online", true)
    .eq("active", true)
    .is("deleted_at", null)
    .eq("open_price", false)
    .order("sort", { ascending: true, nullsFirst: false })
    .order("name");
  const order: Record<string, number> = { membership: 0, service: 1, product: 2 };
  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      kind: row.kind as string,
      priceCents: Number(row.price_cents ?? 0),
      sessions: row.sessions == null ? null : Number(row.sessions),
      membersOnly: Boolean(row.members_only),
      monthly: row.kind === "membership",
    }))
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

export type BuyerForm = { firstName: string; lastName: string; email: string; phone: string; emailConsent: boolean };
export type Buyer = { clientId: string; clientName: string };

export function cleanBuyerForm(raw: unknown): BuyerForm | { error: string } {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const firstName = cleanText(value.firstName, 60);
  const lastName = cleanText(value.lastName, 60);
  const email = normalizeEmail(value.email);
  const phone = normalizePhone(value.phone);
  if (!firstName || !lastName) return { error: "Enter your first and last name." };
  if (!email) return { error: "Enter a valid email address." };
  if (!phone) return { error: "Enter a valid mobile number." };
  return { firstName, lastName, email, phone, emailConsent: value.emailConsent === true };
}

// The person the purchase is for. Creates a lead for someone new.
export async function resolveBuyer(
  admin: Admin,
  organizationId: string,
  who: { member: { mindbodyClientId: string; name: string } } | { form: BuyerForm },
): Promise<Buyer | { error: string; signIn?: boolean }> {
  if ("member" in who) return { clientId: who.member.mindbodyClientId, clientName: who.member.name };
  const form = who.form;
  const signIn = { error: "You already have an account with us. Sign in to buy, so it goes on your account.", signIn: true };

  // A Mindbody client with this email (current or past member): sign in.
  const { data: client } = await admin
    .from("clients")
    .select("mindbody_client_id, status")
    .eq("organization_id", organizationId)
    .ilike("email", form.email)
    .neq("status", "Non-Member")
    .limit(1);
  if (client?.length) return signIn;

  const { data: matches } = await admin
    .from("crm_contacts")
    .select("id, first_name, last_name, mindbody_client_id, status, email_consent")
    .eq("organization_id", organizationId)
    .is("merged_into_id", null)
    .is("deleted_at", null)
    .or(`email_normalized.eq.${form.email},phone_e164.eq.${form.phone}`)
    .order("created_at", { ascending: true })
    .limit(1);
  const match = matches?.[0];
  if (match) {
    if (match.status === "member" || match.mindbody_client_id) {
      const { data: past } = await admin
        .from("member_contracts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("mindbody_client_id", match.mindbody_client_id ?? "")
        .limit(1);
      if (match.status === "member" || past?.length) return signIn;
    }
    if (form.emailConsent && !match.email_consent)
      await admin
        .from("crm_contacts")
        .update({ email_consent: true, email_consent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", match.id);
    return { clientId: `crm:${match.id}`, clientName: `${match.first_name ?? form.firstName} ${match.last_name ?? form.lastName}`.trim() };
  }
  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("crm_contacts")
    .insert({
      organization_id: organizationId,
      first_name: form.firstName,
      last_name: form.lastName,
      email: form.email,
      email_normalized: form.email,
      phone_e164: form.phone,
      status: "lead",
      source: "web",
      how_heard: ["Bought online"],
      email_consent: form.emailConsent,
      email_consent_at: form.emailConsent ? now : null,
      email_check_status: "skipped",
    })
    .select("id")
    .single();
  if (error || !created) return { error: "Couldn't save your details. Try again." };
  return { clientId: `crm:${created.id}`, clientName: `${form.firstName} ${form.lastName}` };
}

function saleRequest(
  buyer: Buyer,
  itemId: string,
  billingStart: "signup" | "prorated",
  agreements: AgreementSignatureRequest[],
  evidence: { ip: string | null; userAgent: string | null },
): CardSaleRequest {
  return {
    clientId: buyer.clientId,
    clientName: buyer.clientName,
    lines: [{ itemId, quantity: 1, none: true }],
    promoCode: null,
    note: "Bought online",
    agreements,
    evidence,
    billingStart,
    online: true,
  };
}

// What it costs and what needs signing (nothing saved). A new buyer was
// saved as a lead when they entered their details (like a website form).
export async function quoteOnline(organizationId: string, buyer: Buyer, itemId: string, billingStart: "signup" | "prorated") {
  const actor = onlineActor(organizationId);
  const request = saleRequest(buyer, itemId, billingStart, [], { ip: null, userAgent: null });
  const forQuote = request;
  const agreements = await savePracticeSale(actor, { ...forQuote, dryRun: true });
  if ("error" in agreements) return agreements;
  const signed = ("agreements" in agreements ? agreements.agreements : []).map((agreement) => ({
    lineIndex: agreement.lineIndex,
    sha256: agreement.sha256,
    signerName: buyer.clientName,
    method: "typed" as const,
    signature: null,
    agreed: true,
  }));
  const totals = await savePracticeSale(actor, { ...forQuote, clientName: buyer.clientName, agreements: signed, validateOnly: true });
  if ("error" in totals) return totals;
  return {
    totalCents: "totalCents" in totals ? totals.totalCents : 0,
    recurring: "recurring" in totals ? totals.recurring : false,
    agreements: "agreements" in agreements ? agreements.agreements : [],
  };
}

export async function startOnlinePayment(
  organizationId: string,
  buyer: Buyer,
  itemId: string,
  billingStart: "signup" | "prorated",
  agreements: AgreementSignatureRequest[],
  evidence: { ip: string | null; userAgent: string | null },
) {
  const admin = createSupabaseAdminClient();
  const { data: item } = await admin
    .from("pos_items")
    .select("id")
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .eq("sell_online", true)
    .maybeSingle();
  if (!item) return { error: "That isn't for sale online." };
  if (!(await cardPaymentsReady(admin, organizationId)))
    return { error: "Online payments aren't available yet. Please buy at the front desk." };
  const started = await startCardPayment(onlineActor(organizationId), saleRequest(buyer, itemId, billingStart, agreements, evidence));
  return "error" in started ? started : { ...started, practice: !stripeLivemode() };
}
