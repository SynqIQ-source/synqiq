import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { refreshClassCounts } from "@/lib/sync/class-counts";
import { syncSynqiqOccurrences } from "@/lib/sync/synqiq-occurrences";

export const maxDuration = 300;

// Cron (vercel.json, every 15 minutes in studio hours): Mindbody's booked
// counts for the next 7 days, for studios whose member booking is open.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient()
    .from("organizations")
    .select("id")
    .eq("member_portal_mode", "open")
    .not("mindbody_site_id", "is", null)
    .is("mindbody_disconnected_at", null);
  const results: Record<string, unknown> = {};
  for (const org of orgs ?? []) {
    try {
      results[org.id as string] = await refreshClassCounts(org.id as string);
    } catch (error) {
      console.error("[class-counts] refresh failed:", error);
      results[org.id as string] = { error: true };
    }
  }
  // Classes scheduled in SynqIQ: their class records (counts, instructor),
  // for every studio that has any, Mindbody or not.
  const { data: synqiqOrgs } = await createSupabaseAdminClient().from("class_schedules").select("organization_id").eq("source", "synqiq");
  const synqiq: Record<string, unknown> = {};
  for (const orgId of new Set((synqiqOrgs ?? []).map((row) => row.organization_id as string))) {
    try {
      synqiq[orgId] = await syncSynqiqOccurrences(orgId);
    } catch (error) {
      console.error("[class-counts] SynqIQ class records failed:", error);
      synqiq[orgId] = { error: true };
    }
  }
  return NextResponse.json({ success: true, results, synqiq });
}
