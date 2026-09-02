import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncSales } from "@/lib/sync/sales";
import { runGatedSync } from "@/lib/sync/sync-state";

// Its own cron target now (two firings in vercel.json), not a passenger
// inside /api/sync/all -- see lib/sync/sync-state.ts and
// supabase/migrations/20260902140000_sync_state.sql for why that changed.
// Still individually callable by hand with explicit
// startSaleDateTime/endSaleDateTime.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const startSaleDateTime = searchParams.get("startSaleDateTime") ?? undefined;
  const endSaleDateTime = searchParams.get("endSaleDateTime") ?? undefined;

  // An explicit window is a deliberate backfill -- bypass the once-a-day gate.
  const force = Boolean(startSaleDateTime || endSaleDateTime);

  const result = await runGatedSync(
    "sales",
    () => syncSales({ startSaleDateTime, endSaleDateTime }),
    { force },
  );

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
