import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { siteIdOr } from "@/lib/sync/sites";
import { allPages, yearWindows } from "@/lib/sync/member-profile";
import { toVisitRow, type MindbodyVisit } from "@/lib/memberships/profile";

// One-time pull of every member's all-time Mindbody visit history (the
// nightly sync keeps only recent visits current). It backs the class roster's
// "12th class · 240 visits", which should match Mindbody's all-time count.
// Read-only against Mindbody; visits are added to member_visits (never
// deleted here). Runs in short, time-limited batches overnight until every
// member is done (member_profile_sync.all_time_visits_at), then does nothing.
//
// Each member is pulled from the year they joined (clients.creation_date) up
// to the stored history's start; the nightly sync covers everything after.

const CONCURRENCY = 3;
const DEFAULT_BUDGET_MS = 240_000;
const EARLIEST = "2015-01-01";
// Where the one-time bulk pull of members' history began.
const BULK_PULL_START = "2026-01-01";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type BackfillResult =
  | { success: true; done: number; failed: number; visitsAdded: number; left: number }
  | { success: false; error: string };

// Pure: the window to pull for one member (exported for tests). Null when
// there's nothing before the stored history.
export function backfillWindow(joined: string | null, historyStart: string): { from: string; to: string } | null {
  const joinedDay = joined ? DateTime.fromISO(joined).toISODate() : null;
  const from = joinedDay && joinedDay > EARLIEST ? DateTime.fromISO(joinedDay).startOf("year").toISODate()! : EARLIEST;
  const to = DateTime.fromISO(historyStart).minus({ days: 1 }).toISODate()!;
  return from <= to ? { from, to } : null;
}

async function pending(supabase: SupabaseAdmin, organizationId: string) {
  const rows: { mindbody_client_id: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("member_profile_sync")
      .select("mindbody_client_id")
      .eq("organization_id", organizationId)
      .is("all_time_visits_at", null)
      .order("synced_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { mindbody_client_id: string }[]));
    if (!data || data.length < 1000) break;
  }
  return rows.map((row) => row.mindbody_client_id);
}

export async function backfillVisitHistory(options: { siteId?: number; budgetMs?: number } = {}): Promise<BackfillResult> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  try {
    const siteId = siteIdOr(options.siteId);
    const supabase = createSupabaseAdminClient();
    const { data: org, error: orgError } = await supabase.from("organizations").select("id").eq("mindbody_site_id", siteId).maybeSingle();
    if (orgError || !org) throw new Error(orgError?.message ?? `No studio for Mindbody site ${siteId}.`);
    const queue = await pending(supabase, org.id);
    if (!queue.length) return { success: true, done: 0, failed: 0, visitsAdded: 0, left: 0 };

    const mindbody = createMindbodyClient({ siteId: String(siteId) });
    const accessToken = await mindbody.requireAccessToken();
    let next = 0;
    let done = 0;
    let failed = 0;
    let visitsAdded = 0;

    const one = async (clientId: string) => {
      const [{ data: client }, { data: earliest }] = await Promise.all([
        supabase.from("clients").select("creation_date").eq("organization_id", org.id).eq("mindbody_client_id", clientId).maybeSingle(),
        supabase
          .from("member_visits")
          .select("start_local")
          .eq("organization_id", org.id)
          .eq("mindbody_client_id", clientId)
          .order("start_local")
          .limit(1)
          .maybeSingle(),
      ]);
      // Up to the stored history: the earliest visit already held, or the
      // start of the bulk pull (Jan 1 2026), whichever is earlier.
      const stored = (earliest?.start_local as string | undefined)?.slice(0, 10);
      const historyStart = stored && stored < BULK_PULL_START ? stored : BULK_PULL_START;
      const window = backfillWindow((client?.creation_date as string | null) ?? null, historyStart);
      const visits: MindbodyVisit[] = [];
      if (window)
        for (const [start, end] of yearWindows(window.from, window.to))
          visits.push(
            ...(await allPages<MindbodyVisit>(
              (offset) => mindbody.getClientVisits(clientId, start, end, offset, accessToken) as Promise<Record<string, unknown>>,
              "Visits",
            )),
          );
      const rows = [...new Map(visits.map((visit) => [visit.Id, toVisitRow(org.id, clientId, visit)])).values()].filter(
        (row): row is NonNullable<typeof row> => row !== null,
      );
      const syncedAt = new Date().toISOString();
      for (let index = 0; index < rows.length; index += 500) {
        const { error } = await supabase
          .from("member_visits")
          .upsert(
            rows.slice(index, index + 500).map((row) => ({ ...row, synced_at: syncedAt })),
            { onConflict: "organization_id,mindbody_visit_id" },
          );
        if (error) throw new Error(`Saving visits failed: ${error.message}`);
      }
      const { error } = await supabase
        .from("member_profile_sync")
        .update({ all_time_visits_at: syncedAt })
        .eq("organization_id", org.id)
        .eq("mindbody_client_id", clientId);
      if (error) throw new Error(error.message);
      visitsAdded += rows.length;
    };

    const worker = async () => {
      while (next < queue.length && Date.now() - startedAt < budgetMs) {
        const clientId = queue[next++];
        try {
          await one(clientId);
          done += 1;
        } catch (error) {
          failed += 1;
          console.error(`[visit-history] ${clientId}:`, error instanceof Error ? error.message : error);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { success: true, done, failed, visitsAdded, left: Math.max(0, queue.length - done) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
