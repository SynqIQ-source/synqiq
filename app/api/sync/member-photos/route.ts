import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { copyMemberPhotos } from "@/lib/memberships/photos";

// Nightly (cron), after the member-profile runs: copy new and changed member
// photos from Mindbody into SynqIQ's private member-photos bucket.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient().from("organizations").select("id").not("mindbody_site_id", "is", null);
  const results: Record<string, unknown> = {};
  const started = Date.now();
  for (const org of orgs ?? []) {
    const left = 270_000 - (Date.now() - started);
    if (left < 20_000) break;
    try {
      results[org.id as string] = await copyMemberPhotos(org.id as string, { budgetMs: left - 10_000 });
    } catch (error) {
      console.error("[sync/member-photos]", org.id, error);
      results[org.id as string] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}
