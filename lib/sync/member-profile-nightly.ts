import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { siteIdOr } from "@/lib/sync/sites";
import { memberClientIds } from "@/lib/sync/member-personal";
import { syncMemberProfile } from "@/lib/sync/member-profile";

// Nightly catch-up of members' visits, bookings, purchases and services
// (after the one-time pull of 2026). Each run works through a queue until a
// time budget runs out; the cron calls it several times overnight and a run
// with nothing left to do returns at once.
//
// Queue (members not refreshed in the last 20 hours), in order:
//   1. never pulled
//   2. active lately: a Mindbody sale in the last 3 days or a class visit in
//      the last 2 days
//   3. the longest-unrefreshed seventh of everyone (so all members are
//      refreshed about once a week; that also catches bookings changes)
// Each refresh re-reads the last 35 days plus 21 days of bookings ahead (the booking window).

const RECENT_DAYS = 35;
const CONCURRENCY = 3;
const DEFAULT_BUDGET_MS = 240_000;
const FRESH_HOURS = 20;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type NightlyProfileResult =
  { success: true; queued: number; refreshed: number; failed: number; leftInQueue: number } | { success: false; error: string };

async function recentlyActive(supabase: SupabaseAdmin, organizationId: string, now: DateTime): Promise<Set<string>> {
  const active = new Set<string>();
  const { data: sales } = await supabase
    .from("sales")
    .select("client_id")
    .eq("organization_id", organizationId)
    .gte("sale_datetime", now.minus({ days: 3 }).toISO()!)
    .not("client_id", "is", null)
    .limit(5000);
  for (const sale of sales ?? []) active.add(sale.client_id as string);

  // Class visits are keyed by Mindbody's client UniqueId.
  const { data: occurrences } = await supabase
    .from("class_occurrences")
    .select("id")
    .eq("organization_id", organizationId)
    .gte("start_datetime", now.minus({ days: 2 }).toISO()!)
    .lte("start_datetime", now.toISO()!)
    .limit(2000);
  const occurrenceIds = (occurrences ?? []).map((row) => row.id as string);
  const uniqueIds = new Set<number>();
  for (let index = 0; index < occurrenceIds.length; index += 200) {
    const { data: visits } = await supabase
      .from("class_visits")
      .select("client_mindbody_unique_id")
      .eq("organization_id", organizationId)
      .in("occurrence_id", occurrenceIds.slice(index, index + 200));
    for (const visit of visits ?? []) uniqueIds.add(Number(visit.client_mindbody_unique_id));
  }
  const unique = [...uniqueIds];
  for (let index = 0; index < unique.length; index += 200) {
    const { data: clients } = await supabase
      .from("clients")
      .select("mindbody_client_id")
      .eq("organization_id", organizationId)
      .in("mindbody_unique_id", unique.slice(index, index + 200));
    for (const client of clients ?? []) if (client.mindbody_client_id) active.add(client.mindbody_client_id as string);
  }
  return active;
}

// Pure: the order members are refreshed in (exported for tests).
export function buildQueue(
  members: string[],
  lastSynced: Map<string, string>, // client id -> synced_at ISO
  active: Set<string>,
  freshSinceIso: string,
): string[] {
  const stale = members.filter((id) => !lastSynced.has(id) || (lastSynced.get(id) as string) < freshSinceIso);
  const never = stale.filter((id) => !lastSynced.has(id));
  const recent = stale.filter((id) => lastSynced.has(id) && active.has(id));
  const rest = stale
    .filter((id) => lastSynced.has(id) && !active.has(id))
    .sort((a, b) => (lastSynced.get(a) as string).localeCompare(lastSynced.get(b) as string))
    .slice(0, Math.ceil(members.length / 7));
  return [...never, ...recent, ...rest];
}

export async function syncMemberProfilesNightly(options: { siteId?: number; budgetMs?: number } = {}): Promise<NightlyProfileResult> {
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
    const now = DateTime.now().setZone((org.timezone as string | null) ?? "America/Chicago");

    const members = await memberClientIds(org.id);
    const lastSynced = new Map<string, string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("member_profile_sync")
        .select("mindbody_client_id, synced_at")
        .eq("organization_id", org.id)
        .order("mindbody_client_id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) lastSynced.set(row.mindbody_client_id as string, new Date(row.synced_at as string).toISOString());
      if (!data || data.length < 1000) break;
    }
    const freshSince = new Date(Date.now() - FRESH_HOURS * 3_600_000).toISOString();
    const queue = buildQueue(members, lastSynced, await recentlyActive(supabase, org.id, now), freshSince);
    if (!queue.length) return { success: true, queued: 0, refreshed: 0, failed: 0, leftInQueue: 0 };

    const mindbody = createMindbodyClient({ siteId: String(siteId) });
    const accessToken = await mindbody.requireAccessToken();
    const historyStart = now.minus({ days: RECENT_DAYS }).toISODate()!;
    let next = 0;
    let refreshed = 0;
    let failed = 0;
    const worker = async () => {
      while (next < queue.length && Date.now() - startedAt < budgetMs) {
        const clientId = queue[next++];
        const result = await syncMemberProfile({
          organizationId: org.id,
          mindbodyClientId: clientId,
          historyStart,
          mindbody,
          accessToken,
          includePersonal: true,
        });
        if (result.success) refreshed += 1;
        else {
          failed += 1;
          console.error(`[member-profiles] ${clientId}: ${result.error}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { success: true, queued: queue.length, refreshed, failed, leftInQueue: Math.max(0, queue.length - next) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
