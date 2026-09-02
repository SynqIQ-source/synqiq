import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClassVisits } from "@/lib/sync/class-visits";
import { runGatedSync } from "@/lib/sync/sync-state";

// Its own cron target now (two firings in vercel.json), not a passenger
// inside /api/sync/all -- see lib/sync/sync-state.ts and
// supabase/migrations/20260902140000_sync_state.sql for why that changed.
//
// One MindBody API call per occurrence + a 250ms pace between them, so the
// nightly 2-day lookback is fine but a wide historical backfill still is
// NOT -- a few thousand occurrences will exceed any serverless budget
// regardless of maxDuration. Run that as a local script calling
// syncClassVisits directly. Pro's 300s ceiling here just gives the nightly
// run headroom on a busy day.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = request.nextUrl.searchParams.get("since") ?? undefined;

  // An explicit `since` is a deliberate backfill -- bypass the once-a-day gate.
  const result = await runGatedSync(
    "class-visits",
    () => syncClassVisits({ since }),
    { force: Boolean(since) },
  );

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
