import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { syncMemberProfilesNightly } from "@/lib/sync/member-profile-nightly";

// Members' visits, bookings, purchases and services (one queue, several
// cron runs overnight in vercel.json; a run with nothing queued returns
// at once). Not gated to once a day: the queue skips members refreshed in
// the last 20 hours.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = [];
  for (const siteId of await sitesForRequest(request.nextUrl.searchParams)) {
    results.push({ siteId, result: await syncMemberProfilesNightly({ siteId }) });
  }
  const { body, success } = combineSiteResults(results);
  return NextResponse.json(body, { status: success ? 200 : 500 });
}
