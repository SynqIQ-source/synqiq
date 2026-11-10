import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { syncMemberContracts } from "@/lib/sync/member-contracts";
import { runGatedSync } from "@/lib/sync/sync-state";

// Members' Mindbody contracts (one Mindbody call per member, within a time
// budget per run). Nightly cron in vercel.json; ?force=1 runs again the same
// day (repeat it to finish the first full pull).
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = request.nextUrl.searchParams.get("force") === "1";
  const results = [];
  for (const siteId of await sitesForRequest(request.nextUrl.searchParams)) {
    results.push({
      siteId,
      result: await runGatedSync("member-contracts", () => syncMemberContracts({ siteId }), { force, siteId }),
    });
  }
  const { body, success } = combineSiteResults(results);
  return NextResponse.json(body, { status: success ? 200 : 500 });
}
