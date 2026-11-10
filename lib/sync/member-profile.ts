import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withRetry } from "@/lib/retry";
import {
  toSaleRows,
  toServiceRow,
  toVisitRow,
  type MindbodyClientPurchase,
  type MindbodyClientService,
  type MindbodyVisit,
} from "@/lib/memberships/profile";
import { toPersonal, type MindbodyClientRecord } from "@/lib/memberships/personal";

// One member's visit history and bookings, purchases (receipts) and services
// (sessions remaining) from Mindbody into member_visits / member_sales /
// member_sale_items / member_services. Read-only against Mindbody (GETs).
//
// For now it runs per member when a Club Admin opens "Refresh from
// Mindbody" on the member's page. Closer to the switch a one-time job runs
// it for every member (from DEFAULT_HISTORY_START), then nightly for
// members with recent activity.

export const DEFAULT_HISTORY_START = "2024-01-01";
const BOOKED_AHEAD_DAYS = 90;
const MAX_PAGES = 50; // 10,000 rows per kind per member

type MindbodyClient = ReturnType<typeof createMindbodyClient>;

async function allPages<T>(fetchPage: (offset: number) => Promise<Record<string, unknown>>, key: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await withRetry(() => fetchPage(page * 200));
    const list = (response[key] as T[] | undefined) ?? [];
    rows.push(...list);
    const total = (response.PaginationResponse as { TotalResults?: number } | undefined)?.TotalResults ?? 0;
    if (list.length < 200 || rows.length >= total) break;
  }
  return rows;
}

// Mindbody's purchases call covers at most a year per request.
function yearWindows(from: string, to: string): [string, string][] {
  const windows: [string, string][] = [];
  let start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (start <= end) {
    const stop = DateTime.min(start.plus({ years: 1 }).minus({ days: 1 }), end);
    windows.push([start.toISODate()!, stop.toISODate()!]);
    start = stop.plus({ days: 1 });
  }
  return windows;
}

export type MemberProfileSyncResult =
  { success: true; visits: number; upcoming: number; sales: number; items: number; services: number } | { success: false; error: string };

export async function syncMemberProfile(options: {
  organizationId: string;
  mindbodyClientId: string;
  historyStart?: string;
  mindbody?: MindbodyClient;
  accessToken?: string;
  // Personal details too (one more call); the bulk run gets them in
  // batches instead (lib/sync/member-personal.ts).
  includePersonal?: boolean;
}): Promise<MemberProfileSyncResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, timezone, mindbody_site_id")
      .eq("id", options.organizationId)
      .maybeSingle();
    if (orgError || !org?.mindbody_site_id) throw new Error(orgError?.message ?? "This studio isn't connected to Mindbody.");
    const mindbody = options.mindbody ?? createMindbodyClient({ siteId: String(org.mindbody_site_id) });
    const accessToken = options.accessToken ?? (await mindbody.requireAccessToken());
    const clientId = options.mindbodyClientId;
    const today = DateTime.now().setZone((org.timezone as string | null) ?? "America/Chicago");
    const from = options.historyStart ?? DEFAULT_HISTORY_START;
    const to = today.plus({ days: BOOKED_AHEAD_DAYS }).toISODate()!;
    const todayIso = today.toISODate()!;

    const visits: MindbodyVisit[] = [];
    for (const [start, end] of yearWindows(from, to)) {
      visits.push(
        ...(await allPages<MindbodyVisit>(
          (offset) => mindbody.getClientVisits(clientId, start, end, offset, accessToken) as Promise<Record<string, unknown>>,
          "Visits",
        )),
      );
    }
    const purchases: MindbodyClientPurchase[] = [];
    for (const [start, end] of yearWindows(from, todayIso)) {
      purchases.push(
        ...(await allPages<MindbodyClientPurchase>(
          (offset) => mindbody.getClientPurchases(clientId, start, end, offset, accessToken) as Promise<Record<string, unknown>>,
          "Purchases",
        )),
      );
    }
    const includePersonal = options.includePersonal !== false;
    const record = includePersonal
      ? ((await withRetry(() => mindbody.getClientById(clientId, accessToken))) as { Clients?: MindbodyClientRecord[] })
      : null;
    const personal = record ? toPersonal(record.Clients?.[0]) : null;
    const services = await allPages<MindbodyClientService>(
      (offset) => mindbody.getClientServices(clientId, offset, accessToken) as Promise<Record<string, unknown>>,
      "ClientServices",
    );

    const visitRows = [...new Map(visits.map((visit) => [visit.Id, toVisitRow(org.id, clientId, visit)])).values()].filter(
      (row): row is NonNullable<typeof row> => row !== null,
    );
    const { sales, items } = toSaleRows(org.id, clientId, purchases);
    const serviceRows = services.map((service) => toServiceRow(org.id, clientId, service)).filter((row) => row !== null);
    const syncedAt = new Date().toISOString();

    const upsert = async (table: string, rows: Record<string, unknown>[], onConflict: string) => {
      for (let index = 0; index < rows.length; index += 500) {
        const { error } = await supabase.from(table).upsert(
          rows.slice(index, index + 500).map((row) => (table === "member_sale_items" ? row : { ...row, synced_at: syncedAt })),
          { onConflict },
        );
        if (error) throw new Error(`Saving ${table} failed: ${error.message}`);
      }
    };
    await upsert("member_visits", visitRows, "organization_id,mindbody_visit_id");
    await upsert("member_sales", sales, "organization_id,mindbody_sale_id");
    await upsert("member_sale_items", items, "organization_id,mindbody_sale_detail_id");
    await upsert("member_services", serviceRows, "organization_id,mindbody_client_service_id");

    // Bookings cancelled since the last pull: drop this member's rows in the
    // pulled window that Mindbody no longer returns.
    const { data: stale } = await supabase
      .from("member_visits")
      .select("id")
      .eq("organization_id", org.id)
      .eq("mindbody_client_id", clientId)
      .gte("start_local", `${from}T00:00:00`)
      .lt("synced_at", syncedAt);
    const staleIds = (stale ?? []).map((row) => row.id as string);
    for (let index = 0; index < staleIds.length; index += 200) {
      await supabase
        .from("member_visits")
        .delete()
        .in("id", staleIds.slice(index, index + 200));
    }
    await supabase
      .from("member_services")
      .delete()
      .eq("organization_id", org.id)
      .eq("mindbody_client_id", clientId)
      .lt("synced_at", syncedAt);

    await supabase.from("member_profile_sync").upsert(
      {
        organization_id: org.id,
        mindbody_client_id: clientId,
        synced_at: syncedAt,
        visits_from: from,
        visit_count: visitRows.length,
        sale_count: sales.length,
        service_count: serviceRows.length,
      },
      { onConflict: "organization_id,mindbody_client_id" },
    );
    // Mindbody's copy only; SynqIQ edits (member_personal.edits) are kept.
    if (personal)
      await supabase
        .from("member_personal")
        .upsert(
          { organization_id: org.id, mindbody_client_id: clientId, mindbody: personal, mindbody_synced_at: syncedAt },
          { onConflict: "organization_id,mindbody_client_id" },
        );

    const nowLocal = today.toFormat("yyyy-LL-dd'T'HH:mm:ss");
    return {
      success: true,
      visits: visitRows.filter((row) => row.start_local <= nowLocal).length,
      upcoming: visitRows.filter((row) => row.start_local > nowLocal).length,
      sales: sales.length,
      items: items.length,
      services: serviceRows.length,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
