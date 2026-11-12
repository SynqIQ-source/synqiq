import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncTrainerAvailability } from "@/lib/trainer/availability-sync";

// Nightly (cron): copy trainers' appointment availability for the next six
// weeks from Mindbody (read only) for every studio on Mindbody.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient().from("organizations").select("id").not("mindbody_site_id", "is", null);
  const results: Record<string, unknown> = {};
  for (const org of orgs ?? []) {
    try {
      results[org.id as string] = await syncTrainerAvailability(org.id as string);
    } catch (error) {
      console.error("[sync/trainer-availability]", org.id, error);
      results[org.id as string] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}
