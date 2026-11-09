import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { syncClasses } from "@/lib/sync/classes";

// Thin wrapper -- see lib/sync/classes.ts for the actual sync logic (which
// carries its own DST-safe "already ran today" gate, keyed off
// class_occurrences.sync_timestamp, and runs a narrow backward pass then a
// 45-day forward pass -- see lib/sync/classes.ts). Its own two cron firings
// in vercel.json, and still shared with app/api/sync/all as the manual
// "run everything" route.
//
// 300: the forward pass sweeps 45 days of a pool schedule that MindBody
// returns ahead of every other room, so it needs the headroom Pro allows.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const locationIdParam = searchParams.get("locationId");

  const results = [];
  for (const siteId of await sitesForRequest(request.nextUrl.searchParams)) {
    results.push({ siteId, result: await syncClasses({
        startDateTime: searchParams.get("startDateTime") ?? undefined,
        endDateTime: searchParams.get("endDateTime") ?? undefined,
        locationId: locationIdParam ? Number(locationIdParam) : undefined,
        siteId,
      }) });
  }
  const { body, success } = combineSiteResults(results);
  return NextResponse.json(body, { status: success ? 200 : 500 });
}
