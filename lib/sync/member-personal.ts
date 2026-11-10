import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withRetry } from "@/lib/retry";
import { siteIdOr } from "@/lib/sync/sites";
import { toPersonal, type MindbodyClientRecord } from "@/lib/memberships/personal";

// Every member's personal information from Mindbody (GET /client/clients,
// 20 members per call) into member_personal.mindbody. SynqIQ edits
// (member_personal.edits) are never touched. Members = everyone with a
// Mindbody contract in SynqIQ. Read-only against Mindbody.

const BATCH = 20; // Mindbody allows at most 20 ClientIds per call

export type SyncMemberPersonalResult = { success: true; members: number; saved: number; calls: number } | { success: false; error: string };

export async function memberClientIds(organizationId: string): Promise<string[]> {
  const supabase = createSupabaseAdminClient();
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("member_contract_sync")
      .select("mindbody_client_id")
      .eq("organization_id", organizationId)
      .gt("contract_count", 0)
      .order("mindbody_client_id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) ids.add(row.mindbody_client_id as string);
    if (!data || data.length < 1000) break;
  }
  return [...ids];
}

export async function syncMemberPersonal(options: { siteId?: number; clientIds?: string[] } = {}): Promise<SyncMemberPersonalResult> {
  try {
    const siteId = siteIdOr(options.siteId);
    const supabase = createSupabaseAdminClient();
    const { data: org, error: orgError } = await supabase.from("organizations").select("id").eq("mindbody_site_id", siteId).maybeSingle();
    if (orgError || !org) throw new Error(orgError?.message ?? `No studio for Mindbody site ${siteId}.`);
    const mindbody = createMindbodyClient({ siteId: String(siteId) });
    const accessToken = await mindbody.requireAccessToken();

    const ids = options.clientIds ?? (await memberClientIds(org.id));
    let saved = 0;
    let calls = 0;
    for (let index = 0; index < ids.length; index += BATCH) {
      const batch = ids.slice(index, index + BATCH);
      const response = (await withRetry(() => mindbody.getClientsByIds(batch, accessToken))) as { Clients?: MindbodyClientRecord[] };
      calls += 1;
      const syncedAt = new Date().toISOString();
      const rows = (response.Clients ?? [])
        .filter((client) => client.Id && batch.includes(String(client.Id)))
        .map((client) => ({
          organization_id: org.id,
          mindbody_client_id: String(client.Id),
          mindbody: toPersonal(client),
          mindbody_synced_at: syncedAt,
        }));
      if (rows.length) {
        const { error } = await supabase.from("member_personal").upsert(rows, { onConflict: "organization_id,mindbody_client_id" });
        if (error) throw new Error(`Saving personal information failed: ${error.message}`);
        saved += rows.length;
      }
    }
    return { success: true, members: ids.length, saved, calls };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
