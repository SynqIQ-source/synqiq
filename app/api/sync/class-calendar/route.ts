import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildClassCalendar } from "@/lib/sync/class-calendar";

// Rolls SynqIQ's class calendar forward each night (the booking window from
// today). Also rebuilt whenever a class type or class time changes.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createSupabaseAdminClient();
  const results = [];
  for (const siteId of await sitesForRequest(request.nextUrl.searchParams)) {
    const { data: org } = await supabase.from("organizations").select("id").eq("mindbody_site_id", siteId).maybeSingle();
    results.push({
      siteId,
      result: org ? await buildClassCalendar(org.id as string) : { success: false as const, error: `No studio for site ${siteId}.` },
    });
  }
  const { body, success } = combineSiteResults(results);
  return NextResponse.json(body, { status: success ? 200 : 500 });
}
