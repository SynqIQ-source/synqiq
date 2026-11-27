import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { backfillVisitHistory } from "@/lib/sync/visit-history-backfill";

// One-time pull of members' all-time Mindbody visits, a few time-limited runs
// each night (vercel.json) until every member is done; then it returns at once.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = [];
  for (const siteId of await sitesForRequest(request.nextUrl.searchParams)) {
    results.push({ siteId, result: await backfillVisitHistory({ siteId }) });
  }
  const { body, success } = combineSiteResults(results);
  return NextResponse.json(body, { status: success ? 200 : 500 });
}
