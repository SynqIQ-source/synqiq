import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { refreshClassCounts } from "@/lib/sync/class-counts";

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
  return NextResponse.json({ success: true, results });
}
