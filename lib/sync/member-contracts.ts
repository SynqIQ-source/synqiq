import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withRetry } from "@/lib/retry";
import { siteIdOr } from "@/lib/sync/sites";
import { toMemberContractRows, toPlanRow } from "@/lib/memberships/contracts";
import type { MindbodyClientContract, MindbodyContractTemplate } from "@/types/mindbody";

// Imports every member's Mindbody contracts (GET /client/clientcontracts,
// one call per member) plus the studio's contract templates
// (GET /sale/contracts) into member_contracts / membership_plans. Read-only
// against Mindbody. Mindbody keeps charging until the switch; this is
// SynqIQ's copy for shadow billing.
//
// Who: members who are Active, Suspended or Declined, plus anyone sold a
// contract in the last 120 days (a future-start membership leaves the
// client "Non-Member" until it begins).
//
// Each run works within a time budget: first members never imported, then
// members with a sale in the last 3 days or a bill date that has passed
// (their schedule moved), then the longest-unrefreshed. Nightly runs cycle
// the whole list about once a week; a manual run (?force=1) repeated a few
// times does the first full pull.

const RECENT_SALE_DAYS = 120;
const CHANGED_SALE_DAYS = 3;
const CONCURRENCY = 4;
const DEFAULT_BUDGET_MS = 240_000;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type SyncMemberContractsResult =
  | { success: true; candidates: number; refreshed: number; contracts: number; failed: number; remainingNeverSynced: number; plans: number }
  | { success: false; error: string };

async function candidateClientIds(supabase: SupabaseAdmin, organizationId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("clients")
      .select("mindbody_client_id")
      .eq("organization_id", organizationId)
      .in("status", ["Active", "Suspended", "Declined"])
      .not("mindbody_client_id", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`Failed to load members: ${error.message}`);
    for (const row of data ?? []) ids.add(row.mindbody_client_id as string);
    if (!data || data.length < 1000) break;
  }
  const since = DateTime.utc().minus({ days: RECENT_SALE_DAYS }).toISO();
  for (const clientId of await clientsWithContractSales(supabase, organizationId, since!)) ids.add(clientId);
  return [...ids];
}

async function clientsWithContractSales(supabase: SupabaseAdmin, organizationId: string, sinceIso: string): Promise<string[]> {
  const { data: sales, error } = await supabase
    .from("sales")
    .select("mindbody_sale_id, client_id")
    .eq("organization_id", organizationId)
    .gte("sale_datetime", sinceIso)
    .not("client_id", "is", null)
    .limit(10000);
  if (error) throw new Error(`Failed to load sales: ${error.message}`);
  const saleIds = (sales ?? []).map((sale) => sale.mindbody_sale_id as string);
  const withContract = new Set<string>();
  for (let index = 0; index < saleIds.length; index += 300) {
    const { data: items, error: itemError } = await supabase
      .from("sale_items")
      .select("mindbody_sale_id")
      .eq("organization_id", organizationId)
      .in("mindbody_sale_id", saleIds.slice(index, index + 300))
      .not("client_contract_id", "is", null);
    if (itemError) throw new Error(`Failed to load sale items: ${itemError.message}`);
    for (const item of items ?? []) withContract.add(item.mindbody_sale_id as string);
  }
  return [...new Set((sales ?? []).filter((sale) => withContract.has(sale.mindbody_sale_id as string)).map((sale) => sale.client_id as string))];
}

async function syncPlans(
  supabase: SupabaseAdmin,
  mindbody: ReturnType<typeof createMindbodyClient>,
  organizationId: string,
  accessToken: string,
): Promise<number> {
  const locations = ((await mindbody.getLocations())?.Locations ?? []) as { Id: number; HasClasses?: boolean }[];
  const location = locations.find((candidate) => candidate.HasClasses) ?? locations[0];
  if (!location) return 0;
  const templates = ((await withRetry(() => mindbody.getContractTemplates(location.Id, accessToken)))?.Contracts ??
    []) as MindbodyContractTemplate[];
  if (templates.length === 0) return 0;
  const now = new Date().toISOString();
  const { error } = await supabase.from("membership_plans").upsert(
    templates.map((template) => ({ ...toPlanRow(template), organization_id: organizationId, synced_at: now, updated_at: now })),
    { onConflict: "organization_id,mindbody_contract_id" },
  );
  if (error) throw new Error(`Failed to save plans: ${error.message}`);
  return templates.length;
}

export async function syncMemberContracts(
  options: { siteId?: number; budgetMs?: number } = {},
): Promise<SyncMemberContractsResult> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  try {
    const siteId = siteIdOr(options.siteId);
    const supabase = createSupabaseAdminClient();
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, timezone")
      .eq("mindbody_site_id", siteId)
      .maybeSingle();
    if (orgError || !org) throw new Error(orgError?.message ?? `No studio for Mindbody site ${siteId}.`);

    const mindbody = createMindbodyClient({ siteId: String(siteId) });
    const accessToken = await mindbody.requireAccessToken();
    const plans = await syncPlans(supabase, mindbody, org.id, accessToken);

    const { data: planRows } = await supabase
      .from("membership_plans")
      .select("id, mindbody_contract_id")
      .eq("organization_id", org.id);
    const planIdByContract = new Map((planRows ?? []).map((row) => [row.mindbody_contract_id as number, row.id as string]));

    const candidates = await candidateClientIds(supabase, org.id);

    // Last refresh per member, and which ones changed recently.
    const lastSynced = new Map<string, string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("member_contract_sync")
        .select("mindbody_client_id, synced_at")
        .eq("organization_id", org.id)
        .range(offset, offset + 999);
      if (error) throw new Error(`Failed to load sync state: ${error.message}`);
      for (const row of data ?? []) lastSynced.set(row.mindbody_client_id as string, row.synced_at as string);
      if (!data || data.length < 1000) break;
    }
    const changed = new Set(
      await clientsWithContractSales(supabase, org.id, DateTime.utc().minus({ days: CHANGED_SALE_DAYS }).toISO()!),
    );
    const today = DateTime.now().setZone(org.timezone ?? "utc").toISODate()!;
    const { data: billed } = await supabase
      .from("member_contracts")
      .select("mindbody_client_id")
      .eq("organization_id", org.id)
      .lt("next_bill_date", today)
      .limit(5000);
    for (const row of billed ?? []) changed.add(row.mindbody_client_id as string);

    const rank = (clientId: string) => (!lastSynced.has(clientId) ? 0 : changed.has(clientId) ? 1 : 2);
    const queue = [...candidates].sort(
      (a, b) => rank(a) - rank(b) || (lastSynced.get(a) ?? "").localeCompare(lastSynced.get(b) ?? ""),
    );

    let refreshed = 0;
    let contracts = 0;
    let failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && Date.now() - startedAt < budgetMs) {
        const clientId = queue[cursor++];
        try {
          const response = await withRetry(() => mindbody.getClientContracts(clientId, accessToken));
          const raw = (response?.Contracts ?? []) as MindbodyClientContract[];
          const rows = toMemberContractRows(clientId, raw).map((row) => ({
            ...row,
            organization_id: org.id,
            plan_id: row.mindbody_contract_id !== null ? (planIdByContract.get(row.mindbody_contract_id) ?? null) : null,
            synced_at: new Date().toISOString(),
          }));
          if (rows.length > 0) {
            const { error } = await supabase
              .from("member_contracts")
              .upsert(rows, { onConflict: "organization_id,mindbody_client_contract_id" });
            if (error) throw new Error(error.message);
          }
          // Contracts Mindbody no longer returns for this member are removed.
          const keep = rows.map((row) => row.mindbody_client_contract_id);
          let removal = supabase.from("member_contracts").delete().eq("organization_id", org.id).eq("mindbody_client_id", clientId);
          if (keep.length > 0) removal = removal.not("mindbody_client_contract_id", "in", `(${keep.join(",")})`);
          const { error: removeError } = await removal;
          if (removeError) throw new Error(removeError.message);
          await supabase.from("member_contract_sync").upsert(
            { organization_id: org.id, mindbody_client_id: clientId, synced_at: new Date().toISOString(), contract_count: rows.length },
            { onConflict: "organization_id,mindbody_client_id" },
          );
          refreshed += 1;
          contracts += rows.length;
        } catch (error) {
          failed += 1;
          console.error(`[member-contracts] client ${clientId} failed:`, error instanceof Error ? error.message : error);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const remainingNeverSynced = queue.slice(cursor).filter((clientId) => !lastSynced.has(clientId)).length;
    return { success: true, candidates: candidates.length, refreshed, contracts, failed, remainingNeverSynced, plans };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
