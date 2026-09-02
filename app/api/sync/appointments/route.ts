import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncAppointments } from "@/lib/sync/appointments";
import { runGatedSync } from "@/lib/sync/sync-state";

// Its own cron target now (two firings in vercel.json), not a passenger
// inside /api/sync/all -- see lib/sync/sync-state.ts and
// supabase/migrations/20260902140000_sync_state.sql for why that changed.
// Still individually callable by hand with explicit startDate/endDate.
//
// 300, not 120: the nightly 7-day window is fast, but a manual multi-week
// backfill (?startDate=...) needs the headroom.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("startDate") ?? undefined;
  const endDate = searchParams.get("endDate") ?? undefined;

  // An explicit window is a deliberate backfill -- bypass the once-a-day
  // gate so it always runs.
  const force = Boolean(startDate || endDate);

  const result = await runGatedSync(
    "appointments",
    () => syncAppointments({ startDate, endDate }),
    { force },
  );

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
