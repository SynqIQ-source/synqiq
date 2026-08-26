import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { delay, withRetry } from "@/lib/retry";
import { getEnv } from "@/lib/env";
import type { MindbodyClientRecord } from "@/types/mindbody";

export type SyncClientsResult =
  | { success: true; imported: number; total: number }
  | { success: false; error: string };

const PAGE_LIMIT = 200;

// Full re-sync every run, not incremental -- same convention as
// syncStaff/syncDepartments in lib/sync/classes.ts. The roster (~14.5k
// clients at this org) is a handful of paginated calls, not one call per
// row like class_visits, so there's no cost/time pressure to only pull
// what changed.
export async function syncClients(): Promise<SyncClientsResult> {
  try {
    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();

    // Site resolution stays Authorization-free -- see lib/sync/classes.ts
    // for why: a staff login's token scopes calls to that staff member's
    // own home site regardless of the SiteId header, which is what caused
    // every sync to resolve to the wrong site historically. Never used for
    // getSite, only for the /client/clients call below.
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

    // Client data is treated as non-public on a plain Api-Key + SiteId
    // request, same as appointments/class visits -- confirmed empirically.
    // Soft-fails rather than failing the whole sync, matching
    // lib/sync/appointments.ts.
    let clientsAccessToken: string | undefined;
    try {
      const clientsAuth = await mindbody.authenticate();
      clientsAccessToken = clientsAuth.AccessToken;
    } catch (authError) {
      console.error("Failed to fetch a clients-visibility user token -- continuing without it:", authError);
    }

    const syncedAt = DateTime.utc().toISO();

    let imported = 0;
    let total = 0;
    let offset = 0;

    for (;;) {
      const page = await withRetry(() =>
        mindbody.getClients(clientsAccessToken, { offset, limit: PAGE_LIMIT }),
      );
      const clients = (page.Clients ?? []) as MindbodyClientRecord[];

      // Only trust TotalResults from a page that actually returned rows --
      // same empirically-confirmed quirk as sales/appointments pagination
      // (lib/sync/sales.ts): the true terminal empty page reports
      // TotalResults: 0 even when every prior page agreed on a higher figure.
      if (clients.length > 0) {
        total = page.PaginationResponse?.TotalResults ?? total;
      }

      // One upsert call per page (up to 200 rows), not one per client -- at
      // ~14.5k clients, a row-at-a-time loop (the convention
      // syncStaff/syncDepartments use, fine at their much smaller scale)
      // took long enough in testing that it didn't finish in 3 minutes.
      // Batching cuts this to ~73 round trips total.
      if (clients.length > 0) {
        const { data: upserted, error } = await supabase
          .from("clients")
          .upsert(
            clients.map((client) => ({
              mindbody_unique_id: client.UniqueId,
              organization_id: org.id,
              first_name: client.FirstName,
              last_name: client.LastName,
              status: client.Status,
              is_prospect: client.IsProspect,
              creation_date: client.CreationDate,
              synced_at: syncedAt,
            })),
            { onConflict: "organization_id,mindbody_unique_id" },
          )
          .select("id");

        if (!error) {
          imported += upserted?.length ?? 0;
        } else {
          console.error(error);
        }
      }

      offset += clients.length;
      if (clients.length === 0 || offset >= total) {
        break;
      }

      await delay(300);
    }

    return { success: true, imported, total };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
