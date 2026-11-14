import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runRatings } from "@/lib/ratings/job";

// Daily (cron), after the class-visit sync: queue and send class rating
// emails. Studios with ratings off are skipped; in tester mode only
// member-portal testers are emailed.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient()
    .from("organizations")
    .select("id")
    .neq("ratings_mode", "off")
    .not("mindbody_site_id", "is", null);
  const results: Record<string, unknown> = {};
  for (const org of orgs ?? []) {
    try {
      results[org.id as string] = await runRatings(org.id as string);
    } catch (error) {
      console.error("[ratings/nightly]", org.id, error);
      results[org.id as string] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}
