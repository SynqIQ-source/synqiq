import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";

// The four syncs that used to ride along inside /api/sync/all with no gate
// of their own. classes is deliberately NOT in this list -- it keeps its
// own gate (lib/sync/classes.ts, keyed off class_occurrences.sync_timestamp)
// and its own two cron firings, and it was never the one going stale.
export type GatedSyncName = "appointments" | "sales" | "clients" | "class-visits";

type SyncResultish = { success: boolean; error?: string };

export type GatedSyncResult =
  | { sync: GatedSyncName; success: true; skipped: true; reason: string }
  | { sync: GatedSyncName; success: true; skipped: false; result: unknown }
  | { sync: GatedSyncName; success: false; error: string; result?: unknown };

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function resolveOrg(supabase: AdminClient) {
  const siteId = Number(getEnv("MINDBODY_SITE_ID"));
  const { data } = await supabase
    .from("organizations")
    .select("id, timezone")
    .eq("mindbody_site_id", siteId)
    .maybeSingle();
  return data ?? null;
}

function errorText(r: SyncResultish, fallback: string) {
  return typeof r.error === "string" && r.error ? r.error : fallback;
}

// Run a sync behind an org-local "already succeeded today" gate, recording
// start/finish status in sync_state so a failure is visible instead of
// being swallowed by the combined route. Pass force:true for a manual run
// with an explicit date window -- a deliberate backfill must never be gated.
export async function runGatedSync<T extends SyncResultish>(
  name: GatedSyncName,
  run: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<GatedSyncResult> {
  const supabase = createSupabaseAdminClient();
  const org = await resolveOrg(supabase);
  const nowIso = () => DateTime.utc().toISO();
  const zone = org?.timezone ?? "utc";

  // No org row yet (first-ever bootstrap): nothing to gate on or write to.
  if (!org) {
    try {
      const result = await run();
      return result.success
        ? { sync: name, success: true, skipped: false, result }
        : { sync: name, success: false, error: errorText(result, "Sync failed."), result };
    } catch (err) {
      return { sync: name, success: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  const localToday = DateTime.utc().setZone(zone).toISODate();
  const key = { organization_id: org.id, sync_name: name };

  const { data: state } = await supabase
    .from("sync_state")
    .select("last_status, last_run_at, last_success_at")
    .match(key)
    .maybeSingle();

  if (!opts.force) {
    const lastSuccessDate = state?.last_success_at
      ? DateTime.fromISO(state.last_success_at, { zone: "utc" }).setZone(zone).toISODate()
      : null;

    if (lastSuccessDate === localToday) {
      return {
        sync: name,
        success: true,
        skipped: true,
        reason: `Already synced today (local date ${localToday} in ${zone}).`,
      };
    }
  }

  // A serverless timeout / hard kill has no finally, so a run that died
  // mid-flight leaves last_status stuck on "running". The gate above keys
  // off last_success_at so it doesn't block anything, but an observer
  // reading last_status can't tell "in progress" from "crashed days ago" --
  // so if the "running" row is older than any run could plausibly still be
  // going, record it as the failure it was before starting the new attempt.
  const STALE_RUNNING_MS = 20 * 60 * 1000;
  if (
    state?.last_status === "running" &&
    state.last_run_at &&
    Date.now() - new Date(state.last_run_at).getTime() > STALE_RUNNING_MS
  ) {
    await supabase.from("sync_state").upsert(
      { ...key, last_status: "error", last_error: "Previous run did not finish (timed out or crashed)." },
      { onConflict: "organization_id,sync_name" },
    );
  }

  await supabase
    .from("sync_state")
    .upsert({ ...key, last_run_at: nowIso(), last_status: "running", last_error: null }, { onConflict: "organization_id,sync_name" });

  let result: T;
  try {
    result = await run();
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("sync_state")
      .upsert({ ...key, last_run_at: nowIso(), last_status: "error", last_error: error }, { onConflict: "organization_id,sync_name" });
    return { sync: name, success: false, error };
  }

  if (result.success) {
    const ts = nowIso();
    await supabase.from("sync_state").upsert(
      { ...key, last_run_at: ts, last_success_at: ts, last_status: "success", last_error: null, last_result: result as unknown as Record<string, unknown> },
      { onConflict: "organization_id,sync_name" },
    );
    return { sync: name, success: true, skipped: false, result };
  }

  const error = errorText(result, "Sync reported failure.");
  await supabase.from("sync_state").upsert(
    { ...key, last_run_at: nowIso(), last_status: "error", last_error: error, last_result: result as unknown as Record<string, unknown> },
    { onConflict: "organization_id,sync_name" },
  );
  return { sync: name, success: false, error, result };
}
