import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClients } from "@/lib/sync/clients";
import { runGatedSync } from "@/lib/sync/sync-state";

// Its own cron target now (two firings in vercel.json), not a passenger
// inside /api/sync/all -- see lib/sync/sync-state.ts and
// supabase/migrations/20260902140000_sync_state.sql for why that changed.
// Full roster re-pull (~14.5k rows, a few hundred paginated calls), so it
// gets Pro's higher ceiling rather than Hobby's old 60s.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // No date window on this sync -- ?force=1 is the manual "run again now
  // even though it already ran today" override.
  const force = request.nextUrl.searchParams.get("force") === "1";

  const result = await runGatedSync("clients", () => syncClients(), { force });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
