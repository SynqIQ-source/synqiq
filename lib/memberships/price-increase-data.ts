import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";
import {
  increasedCents,
  matchesFilters,
  type IncreaseCandidate,
  type IncreaseFilters,
  type ScheduledIncrease,
} from "@/lib/memberships/price-increase";
import { contractTaxRate } from "@/lib/memberships/tax";

// Loads for bulk price increases, through the Club Admin's RLS-scoped client.

const PAGE = 1000;

export async function loadCandidates(supabase: ScopedSupabaseClient, organizationId: string): Promise<IncreaseCandidate[]> {
  type Row = {
    id: string;
    mindbody_client_contract_id: number;
    mindbody_client_id: string;
    contract_name: string;
    original_start_date: string | null;
    start_date: string | null;
    end_date: string | null;
    autopay_status: string | null;
    auto_renewing: boolean | null;
    normal_autopay_cents: number | null;
    next_bill_subtotal_cents: number | null;
    next_bill_tax_cents: number | null;
  };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("member_contracts")
      .select(
        "id, mindbody_client_contract_id, mindbody_client_id, contract_name, original_start_date, start_date, end_date, autopay_status, auto_renewing, normal_autopay_cents, next_bill_subtotal_cents, next_bill_tax_cents",
      )
      .eq("organization_id", organizationId)
      .order("id")
      .range(offset, offset + PAGE - 1)
      .returns<Row[]>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const candidates = rows.map((row) => ({
    contractId: row.id,
    mindbodyClientContractId: Number(row.mindbody_client_contract_id),
    mindbodyClientId: row.mindbody_client_id,
    contractName: row.contract_name,
    originalStartDate: row.original_start_date,
    startDate: row.start_date,
    endDate: row.end_date,
    autopayStatus: row.autopay_status,
    autoRenewing: row.auto_renewing,
    normalAutopayCents: row.normal_autopay_cents,
    taxRate: contractTaxRate({
      nextBillSubtotalCents: row.next_bill_subtotal_cents,
      nextBillTaxCents: row.next_bill_tax_cents,
    }),
  }));
  // Memberships with no upcoming bill to read tax from (e.g. frozen) use
  // the studio's most common rate.
  const counts = new Map<number, number>();
  for (const candidate of candidates) {
    if (candidate.taxRate === null) continue;
    const rate = Math.round(candidate.taxRate * 10_000) / 10_000;
    counts.set(rate, (counts.get(rate) ?? 0) + 1);
  }
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return candidates.map((candidate) => ({
    ...candidate,
    taxRate: candidate.taxRate ?? usual,
  }));
}

// Increases not cancelled, per member contract (optionally one member's).
export async function loadScheduledIncreases(
  supabase: ScopedSupabaseClient,
  organizationId: string,
  mindbodyClientId?: string,
): Promise<(ScheduledIncrease & { name: string; percent: number; increaseId: string })[]> {
  type Row = {
    id: string;
    member_contract_id: string | null;
    old_cents: number;
    new_cents: number;
    price_increases: {
      id: string;
      name: string;
      percent: number;
      effective_on: string;
      cancelled_at: string | null;
    };
  };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = supabase
      .from("price_increase_items")
      .select("id, member_contract_id, old_cents, new_cents, price_increases!inner(id, name, percent, effective_on, cancelled_at)")
      .eq("organization_id", organizationId)
      .is("price_increases.cancelled_at", null);
    if (mindbodyClientId) query = query.eq("mindbody_client_id", mindbodyClientId);
    const { data, error } = await query
      .order("id")
      .range(offset, offset + PAGE - 1)
      .returns<Row[]>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows
    .filter((row) => row.member_contract_id)
    .map((row) => ({
      id: row.price_increases.id,
      increaseId: row.price_increases.id,
      contractId: row.member_contract_id as string,
      effectiveOn: row.price_increases.effective_on,
      oldCents: row.old_cents,
      newCents: row.new_cents,
      name: row.price_increases.name,
      percent: Number(row.price_increases.percent),
    }));
}

export type PreviewRow = IncreaseCandidate & {
  newCents: number;
  alreadyScheduled: string | null;
};

// The memberships a search covers, with their new dues. Memberships already
// in a scheduled increase are flagged (and left out when scheduling).
export function previewIncrease(
  candidates: IncreaseCandidate[],
  scheduled: { contractId: string; name: string }[],
  filters: IncreaseFilters,
  percent: number,
  roundToDollar: boolean,
  today: string,
): PreviewRow[] {
  const scheduledBy = new Map(scheduled.map((item) => [item.contractId, item.name]));
  return candidates
    .filter((contract) => matchesFilters(contract, filters, today))
    .map((contract) => ({
      ...contract,
      newCents: increasedCents(contract.normalAutopayCents as number, percent, roundToDollar),
      alreadyScheduled: scheduledBy.get(contract.contractId) ?? null,
    }))
    .sort(
      (a, b) =>
        (a.originalStartDate ?? a.startDate ?? "").localeCompare(b.originalStartDate ?? b.startDate ?? "") ||
        a.mindbodyClientId.localeCompare(b.mindbodyClientId),
    );
}

export async function loadClientNames(supabase: ScopedSupabaseClient, organizationId: string, ids: string[]) {
  const names = new Map<string, { first: string; last: string }>();
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 200) {
    const { data } = await supabase
      .from("clients")
      .select("mindbody_client_id, first_name, last_name")
      .eq("organization_id", organizationId)
      .in("mindbody_client_id", unique.slice(index, index + 200));
    for (const row of data ?? [])
      names.set(row.mindbody_client_id as string, {
        first: row.first_name as string,
        last: row.last_name as string,
      });
  }
  return names;
}
