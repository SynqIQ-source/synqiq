import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { delay, withRetry } from "@/lib/retry";
import { getEnv } from "@/lib/env";
import { asOccurrenceId } from "@/lib/mindbody/types";
import type { MindbodyClassVisit } from "@/types/mindbody";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type OccurrenceRow = { id: string; mindbody_occurrence_id: number };

const OCCURRENCE_PAGE_SIZE = 1000;

// Same 1000-row PostgREST cap as every other paginated read in this app
// (see app/dashboard/page.tsx's getOverviewRows) -- a plain unbounded
// select silently truncates past it, and the backfill window here can be
// well over 1000 rows.
async function getOccurrencesInWindow(
  supabase: SupabaseAdminClient,
  organizationId: string,
  since: string,
): Promise<OccurrenceRow[]> {
  const allRows: OccurrenceRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("class_occurrences")
      .select("id, mindbody_occurrence_id")
      .eq("organization_id", organizationId)
      .not("mindbody_occurrence_id", "is", null)
      .gte("start_datetime", since)
      // Only occurred classes have visits to pull -- an upcoming class's
      // attendance is meaningless (same rule Overview's This-period columns
      // already apply).
      .lte("start_datetime", DateTime.utc().toISO() ?? "")
      .range(offset, offset + OCCURRENCE_PAGE_SIZE - 1)
      .returns<OccurrenceRow[]>();

    if (error) {
      throw new Error(`Failed to load occurrences for class-visits sync: ${error.message}`);
    }

    allRows.push(...(data ?? []));

    if (!data || data.length < OCCURRENCE_PAGE_SIZE) {
      break;
    }

    offset += OCCURRENCE_PAGE_SIZE;
  }

  return allRows;
}

export type SyncClassVisitsOptions = {
  // ISO datetime -- only occurrences starting on/after this are visited.
  // Defaults to a short nightly lookback; a historical backfill passes an
  // explicit, much earlier value. No forward window: a class that hasn't
  // occurred yet has no visits.
  since?: string;
};

export type SyncClassVisitsResult =
  | { success: true; occurrencesProcessed: number; visitsImported: number; occurrencesFailed: number }
  | { success: false; error: string };

// One MindBody API call per occurrence (GET /class/classvisits has no
// bulk/date-range form) -- this is the expensive sync in both time and
// metered API cost, unlike clients/classes/appointments/sales which are
// all a handful of paginated list calls. Keep the nightly `since` window
// tight; a wide `since` (e.g. a historical backfill) is expected to be run
// as a one-off script, not through this app's request-scoped cron route,
// since a few thousand sequential calls will exceed any serverless
// function's execution-time budget.
const DEFAULT_LOOKBACK_DAYS = 2;
const DELAY_BETWEEN_OCCURRENCES_MS = 250;

export async function syncClassVisits(options: SyncClassVisitsOptions = {}): Promise<SyncClassVisitsResult> {
  try {
    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();

    // Site resolution stays Authorization-free -- see lib/sync/classes.ts.
    const configuredSiteId = Number(getEnv("MINDBODY_SITE_ID"));
    const siteResult = await mindbody.getSite();
    const site = siteResult.Sites?.find((candidate: { Id: number }) => candidate.Id === configuredSiteId);

    if (!site) {
      throw new Error(
        `MindBody /site/sites did not return a site matching MINDBODY_SITE_ID=${configuredSiteId}.`,
      );
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .upsert(
        { mindbody_site_id: site.Id, timezone: site.TimeZone, name: site.Name },
        { onConflict: "mindbody_site_id" },
      )
      .select()
      .single();

    if (orgError || !org) {
      throw new Error(orgError?.message ?? "Failed to upsert organization.");
    }

    // Class-visit data is treated as non-public on a plain Api-Key + SiteId
    // request, same as appointments/clients -- confirmed empirically.
    let visitsAccessToken: string | undefined;
    try {
      const visitsAuth = await mindbody.authenticate();
      visitsAccessToken = visitsAuth.AccessToken;
    } catch (authError) {
      console.error("Failed to fetch a class-visits-visibility user token -- continuing without it:", authError);
    }

    const since = options.since ?? DateTime.utc().minus({ days: DEFAULT_LOOKBACK_DAYS }).toISO() ?? "";
    const occurrences = await getOccurrencesInWindow(supabase, org.id, since);
    const syncedAt = DateTime.utc().toISO();

    let visitsImported = 0;
    let occurrencesFailed = 0;

    for (const [index, occurrence] of occurrences.entries()) {
      // Per-occurrence, not per-run -- a single occurrence exhausting
      // withRetry's 3 attempts (a genuinely unreachable class, not just a
      // transient blip) used to throw out of this loop entirely, aborting
      // every occurrence still queued behind it. One bad occurrence out of
      // several thousand shouldn't cost the rest of the sync.
      try {
        const page = await withRetry(() =>
          mindbody.getClassVisits(asOccurrenceId(occurrence.mindbody_occurrence_id), visitsAccessToken),
        );
        const rawVisits = (page.Class?.Visits ?? []) as MindbodyClassVisit[];

        // A single occurrence can legitimately list the same client twice
        // (confirmed empirically during backfill testing -- e.g. a normal
        // booking plus a separate walk-in/badge-scan record) -- upserting
        // both in one batch throws "ON CONFLICT DO UPDATE command cannot
        // affect row a second time" (Postgres can't apply two conflicting
        // values in a single INSERT), which failed the WHOLE occurrence's
        // batch, not just the duplicate row. De-duped here first,
        // signed_in=true winning over false on a collision since "did they
        // attend" should reflect either record saying yes.
        const visitsByClient = new Map<number, MindbodyClassVisit>();
        for (const visit of rawVisits) {
          const existing = visitsByClient.get(visit.ClientUniqueId);
          if (!existing || (!existing.SignedIn && visit.SignedIn)) {
            visitsByClient.set(visit.ClientUniqueId, visit);
          }
        }
        const visits = Array.from(visitsByClient.values());

        // One upsert call per occurrence's whole visit list, not one per
        // visit -- same reasoning as lib/sync/clients.ts's page-level
        // batching. Matters more here: the backfill runs this across
        // thousands of occurrences, so trimming even a few round trips per
        // occurrence adds up.
        if (visits.length > 0) {
          const { data: upserted, error } = await supabase
            .from("class_visits")
            .upsert(
              visits.map((visit) => ({
                organization_id: org.id,
                occurrence_id: occurrence.id,
                client_mindbody_unique_id: visit.ClientUniqueId,
                signed_in: visit.SignedIn,
                synced_at: syncedAt,
              })),
              { onConflict: "organization_id,occurrence_id,client_mindbody_unique_id" },
            )
            .select("id");

          if (!error) {
            visitsImported += upserted?.length ?? 0;
          } else {
            console.error(
              `class_visits upsert failed for occurrence ${occurrence.mindbody_occurrence_id} (${occurrence.id}): raw=${rawVisits.length} deduped=${visits.length} clientIds=${JSON.stringify(visits.map((v) => v.ClientUniqueId))}`,
              error,
            );
          }
        }
      } catch (occurrenceError) {
        occurrencesFailed++;
        console.error(
          `Skipping occurrence ${occurrence.mindbody_occurrence_id} (${occurrence.id}) after repeated failures:`,
          occurrenceError,
        );
      }

      // Visible forward-progress signal -- a run over several thousand
      // occurrences can otherwise go long stretches with nothing printed
      // (a successful upsert logs nothing), which is indistinguishable
      // from a hang when watching the log from outside.
      if ((index + 1) % 100 === 0) {
        console.log(
          `class-visits sync progress: ${index + 1}/${occurrences.length} occurrences, ${visitsImported} visits imported, ${occurrencesFailed} failed`,
        );
      }

      await delay(DELAY_BETWEEN_OCCURRENCES_MS);
    }

    return { success: true, occurrencesProcessed: occurrences.length, visitsImported, occurrencesFailed };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
