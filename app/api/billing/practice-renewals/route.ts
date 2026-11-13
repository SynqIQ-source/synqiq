import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runPracticeBilling } from "@/lib/billing/practice-job";

// Nightly (cron), after the Mindbody sale sync: record practice charges for
// billing-test members and check them against Mindbody's charges. Nothing
// is charged.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await createSupabaseAdminClient().from("billing_test_members").select("organization_id");
  const orgs = [...new Set((data ?? []).map((row) => row.organization_id as string))];
  const results: Record<string, unknown> = {};
  for (const org of orgs) {
    try {
      results[org] = await runPracticeBilling(org);
    } catch (error) {
      console.error("[billing/practice-renewals]", org, error);
      results[org] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}
