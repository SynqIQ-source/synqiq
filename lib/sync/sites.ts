import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOptionalEnv } from "@/lib/env";

// Which Mindbody sites the syncs run for: every organization marked
// connected to Mindbody (organizations.mindbody_connected). One Source login
// (MINDBODY_USERNAME/PASSWORD) reads every site that has approved Synq's
// activation link, so a new studio is just a new connected org.
//
// Falls back to MINDBODY_SITE_ID while no org is marked connected (or the
// column doesn't exist yet), so a deploy can never quietly stop the
// nightly syncs.
export async function connectedSiteIds(): Promise<number[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("mindbody_site_id")
    .eq("mindbody_connected", true)
    .order("created_at");
  const sites = error ? [] : (data ?? []).map((row) => Number(row.mindbody_site_id)).filter(Number.isFinite);
  if (sites.length > 0) return sites;
  const fallback = Number(getOptionalEnv("MINDBODY_SITE_ID"));
  return Number.isFinite(fallback) && fallback !== 0 ? [fallback] : [];
}

// The site a sync or Mindbody call is for: the one asked for, else
// MINDBODY_SITE_ID (single-studio callers that haven't been given one).
export function siteIdOr(siteId: number | undefined): number {
  if (siteId !== undefined) return siteId;
  const fallback = Number(getOptionalEnv("MINDBODY_SITE_ID"));
  if (!Number.isFinite(fallback) || fallback === 0) throw new Error("No Mindbody site given and MINDBODY_SITE_ID isn't set.");
  return fallback;
}

// Run `run` once per connected site, in order, collecting each result. A
// failure on one studio never stops the others.
export async function forEachSite<T>(run: (siteId: number) => Promise<T>): Promise<{ siteId: number; result: T }[]> {
  const results: { siteId: number; result: T }[] = [];
  for (const siteId of await connectedSiteIds()) {
    results.push({ siteId, result: await run(siteId) });
  }
  return results;
}

// The sites a sync route runs for: ?siteId=<id> for one studio (a manual
// run or backfill), else every connected studio.
export async function sitesForRequest(searchParams: URLSearchParams): Promise<number[]> {
  const requested = searchParams.get("siteId");
  if (requested !== null) {
    const siteId = Number(requested);
    return Number.isFinite(siteId) ? [siteId] : [];
  }
  return connectedSiteIds();
}

// One studio: its result exactly as before. Several: each result by site,
// failing overall if any studio failed.
export function combineSiteResults<T extends { success: boolean }>(
  results: { siteId: number; result: T }[],
): { body: unknown; success: boolean } {
  if (results.length === 1) return { body: results[0].result, success: results[0].result.success };
  const success = results.length > 0 && results.every((entry) => entry.result.success);
  return { body: { success, sites: results }, success };
}
