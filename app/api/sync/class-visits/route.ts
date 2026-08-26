import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClassVisits } from "@/lib/sync/class-visits";

// Thin wrapper -- see lib/sync/class-visits.ts for the actual sync logic,
// shared with app/api/sync/all/route.ts (the endpoint vercel.json's cron
// entries actually hit, to stay within Hobby's 2-cron-job cap). Kept as its
// own route so it's still individually callable by hand with an explicit
// `since`.
//
// NOT the right tool for a wide historical backfill -- one MindBody API
// call per occurrence means a few thousand occurrences will exceed any
// serverless function's execution-time budget regardless of maxDuration.
// Run a backfill as a local script calling syncClassVisits directly instead.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;

  const result = await syncClassVisits({
    since: searchParams.get("since") ?? undefined,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
