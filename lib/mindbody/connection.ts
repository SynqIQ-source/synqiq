import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// The Mindbody off switch (docs/mindbody-integration.md). Every Mindbody call
// goes through MindbodyClient.request, which asks here first:
//   - MINDBODY_DISABLED=true turns Mindbody off everywhere;
//   - a studio's Settings > "Mindbody connection" (organizations.
//     mindbody_disconnected_at) turns it off for that studio's site.
// Cached for a minute so the check costs nothing per call.

export class MindbodyDisconnectedError extends Error {
  constructor(siteId: string) {
    super(`Mindbody is switched off for site ${siteId}.`);
    this.name = "MindbodyDisconnectedError";
  }
}

export const mindbodyGloballyDisabled = () => process.env.MINDBODY_DISABLED === "true";

let cache: { at: number; sites: Set<string> } | null = null;

export async function disconnectedSites(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.sites;
  const { data, error } = await createSupabaseAdminClient()
    .from("organizations")
    .select("mindbody_site_id")
    .not("mindbody_disconnected_at", "is", null)
    .not("mindbody_site_id", "is", null);
  // A read failure must not silently re-enable a switched-off studio: keep
  // the last known list.
  if (error) return cache?.sites ?? new Set();
  cache = { at: Date.now(), sites: new Set((data ?? []).map((row) => String(row.mindbody_site_id))) };
  return cache.sites;
}

export async function assertMindbodyConnected(siteId: string) {
  if (mindbodyGloballyDisabled() || (await disconnectedSites()).has(String(siteId))) throw new MindbodyDisconnectedError(siteId);
}

// After the switch changes (so this server sees it right away).
export function forgetMindbodyConnectionCache() {
  cache = null;
}
