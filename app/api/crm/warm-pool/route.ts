import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWarmPool } from "@/lib/crm/warm-pool";

// Nightly (cron): move leads with every contact attempt made and no reply
// into the warm lead pool, and back out when they re-engage. CRM studios only.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient()
    .from("org_modules")
    .select("organization_id")
    .eq("module", "crm")
    .eq("status", "enabled");
  const results: Record<string, unknown> = {};
  for (const row of orgs ?? []) {
    const id = row.organization_id as string;
    try {
      results[id] = await runWarmPool(id);
    } catch (error) {
      console.error("[crm/warm-pool]", id, error);
      results[id] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}
