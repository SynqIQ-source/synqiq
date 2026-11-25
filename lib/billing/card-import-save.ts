import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStudioStripeAccount } from "@/lib/payments/connect";
import { saveMemberCard } from "@/lib/billing/member-cards";
import type { ImportRow } from "@/lib/billing/card-import";

// Saving the cards Stripe migrated from Mindbody (Jan 1 cutover). Each row of
// Stripe's mapping file (Mindbody client -> Stripe customer + card) is checked
// against Stripe before anything is saved: the card must exist on the studio's
// own Stripe account, belong to that customer, and be a card. Then it's saved
// as the member's dues card (member_cards, updated_via "import"), exactly like
// a card added at the desk, so the cutover's "create schedules" step picks it
// up. A card the member has already added in SynqIQ themselves is kept (it's
// newer than Mindbody's). Run with dryRun first: same checks, nothing saved.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MAX_IMPORT_ROWS = 2500;

export type ImportOutcome = {
  checked: number;
  saved: number; // saved (or, on a dry run, would be saved)
  unchanged: number; // the same card is already saved
  keptMemberCard: number; // the member already added their own card in SynqIQ
  notMembers: number; // client ID isn't a member of this studio
  failed: number; // Stripe check failed
  problems: string[]; // first 25, for the screen
  dryRun: boolean;
};

export type CardCheck =
  | { ok: true; card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } }
  | { ok: false; reason: string };

// Pure: does this Stripe payment method belong to that customer, and is it a card?
export function checkImportedCard(method: Pick<Stripe.PaymentMethod, "type" | "customer" | "card"> | null, customerId: string): CardCheck {
  if (!method) return { ok: false, reason: "card not found on the studio's Stripe account" };
  const owner = typeof method.customer === "string" ? method.customer : (method.customer?.id ?? null);
  if (owner !== customerId) return { ok: false, reason: "card belongs to a different Stripe customer" };
  if (method.type !== "card" || !method.card) return { ok: false, reason: "not a card" };
  return {
    ok: true,
    card: {
      brand: method.card.brand ?? null,
      last4: method.card.last4 ?? null,
      expMonth: method.card.exp_month ?? null,
      expYear: method.card.exp_year ?? null,
    },
  };
}

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(work));
}

export async function saveImportedCards(
  organizationId: string,
  staffId: string,
  rows: ImportRow[],
  options: { dryRun: boolean },
): Promise<ImportOutcome | { error: string }> {
  if (rows.length > MAX_IMPORT_ROWS) return { error: `The file has ${rows.length} cards; split it into files of ${MAX_IMPORT_ROWS} or fewer.` };
  const admin: Admin = createSupabaseAdminClient();
  const account = await getStudioStripeAccount(admin, organizationId);
  if (!account?.ready) return { error: "The studio's Stripe account isn't connected and ready yet (Settings > Payments)." };

  const outcome: ImportOutcome = {
    checked: 0,
    saved: 0,
    unchanged: 0,
    keptMemberCard: 0,
    notMembers: 0,
    failed: 0,
    problems: [],
    dryRun: options.dryRun,
  };
  const problem = (row: ImportRow, text: string) => {
    if (outcome.problems.length < 25) outcome.problems.push(`Line ${row.line} (client ${row.clientId}): ${text}`);
  };

  // One card per member: the last row in the file wins.
  const byClient = new Map(rows.map((row) => [row.clientId, row]));
  const ids = [...byClient.keys()];
  const members = new Set<string>();
  const saved = new Map<string, { paymentMethodId: string; via: string }>();
  for (let index = 0; index < ids.length; index += 300) {
    const slice = ids.slice(index, index + 300);
    const [{ data: clients }, { data: cards }] = await Promise.all([
      admin.from("clients").select("mindbody_client_id").eq("organization_id", organizationId).in("mindbody_client_id", slice),
      admin
        .from("member_cards")
        .select("mindbody_client_id, stripe_payment_method_id, updated_via")
        .eq("organization_id", organizationId)
        .eq("livemode", account.livemode)
        .eq("purpose", "dues")
        .in("mindbody_client_id", slice),
    ]);
    for (const row of clients ?? []) members.add(row.mindbody_client_id as string);
    for (const row of cards ?? [])
      saved.set(row.mindbody_client_id as string, {
        paymentMethodId: row.stripe_payment_method_id as string,
        via: row.updated_via as string,
      });
  }

  const stripe = getStripe();
  await inBatches([...byClient.values()], 8, async (row) => {
    outcome.checked += 1;
    if (!members.has(row.clientId)) {
      outcome.notMembers += 1;
      return problem(row, "not a member of this studio in SynqIQ");
    }
    const existing = saved.get(row.clientId);
    if (existing?.paymentMethodId === row.paymentMethodId) {
      outcome.unchanged += 1;
      return;
    }
    if (existing && existing.via !== "import") {
      outcome.keptMemberCard += 1;
      return;
    }
    let method: Stripe.PaymentMethod | null = null;
    try {
      method = await stripe.paymentMethods.retrieve(row.paymentMethodId, {}, { stripeAccount: account.stripeAccountId });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "resource_missing") {
        outcome.failed += 1;
        return problem(row, "Stripe couldn't be reached for this card; run it again");
      }
    }
    const check = checkImportedCard(method, row.customerId);
    if (!check.ok) {
      outcome.failed += 1;
      return problem(row, check.reason);
    }
    if (!options.dryRun)
      await saveMemberCard(admin, {
        organizationId,
        clientId: row.clientId,
        livemode: account.livemode,
        accountId: account.stripeAccountId,
        customerId: row.customerId,
        paymentMethodId: row.paymentMethodId,
        card: check.card,
        via: "import",
        staffId,
        purpose: "dues",
      });
    outcome.saved += 1;
  });
  return outcome;
}
