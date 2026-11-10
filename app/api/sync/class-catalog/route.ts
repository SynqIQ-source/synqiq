import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { syncClassCatalog } from "@/lib/sync/class-catalog";
import { runGatedSync } from "@/lib/sync/sync-state";

// The class catalog (programs, rooms, class types, schedules, session
// types) from Mindbody, once a day; ?force=1 runs again.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = request.nextUrl.searchParams.get("force") === "1";
  const results = [];
  for (const siteId of await sitesForRequest(request.nextUrl.searchParams)) {
    results.push({ siteId, result: await runGatedSync("class-catalog", () => syncClassCatalog({ siteId }), { force, siteId }) });
  }
  const { body, success } = combineSiteResults(results);
  return NextResponse.json(body, { status: success ? 200 : 500 });
}
