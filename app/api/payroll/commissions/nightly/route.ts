import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeCommissions } from "@/lib/payroll/commission-job";

// Nightly (cron), after the sale and member-profile syncs: figure commission
// for the last 45 days of sales for every studio that has a commission plan.
// Existing lines are never rewritten; new sales, approved handoffs and
// returns are picked up.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const { data: plans } = await admin.from("commission_plans").select("organization_id").is("archived_at", null);
  const orgs = [...new Set((plans ?? []).map((row) => row.organization_id as string))];
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const from = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const results: Record<string, unknown> = {};
  for (const org of orgs) {
    try {
      results[org] = await computeCommissions(org, from, to);
    } catch (error) {
      console.error("[payroll/commissions]", org, error);
      results[org] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}
