import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncSales } from "@/lib/sync/sales";

// Thin wrapper -- see lib/sync/sales.ts for the actual sync logic, shared
// with app/api/sync/all/route.ts (the endpoint vercel.json's cron entries
// actually hit, to stay within Hobby's 2-cron-job cap). Kept as its own
// route so it's still individually callable by hand with explicit
// startSaleDateTime/endSaleDateTime.
export async function GET(request: NextRequest) {
  // Same CRON_SECRET gate as classes -- this route writes to the DB and
  // calls the MindBody API on every hit, and is now wired to Vercel Cron
  // (via /api/sync/all), so it can no longer stay an unauthenticated public
  // trigger for either.
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;

  const result = await syncSales({
    startSaleDateTime: searchParams.get("startSaleDateTime") ?? undefined,
    endSaleDateTime: searchParams.get("endSaleDateTime") ?? undefined,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
