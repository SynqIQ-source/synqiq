import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClasses } from "@/lib/sync/classes";

// Thin wrapper -- see lib/sync/classes.ts for the actual sync logic, shared
// with app/api/sync/all/route.ts (the endpoint vercel.json's cron entries
// actually hit, to stay within Hobby's 2-cron-job cap). Kept as its own
// route so it's still individually callable by hand with explicit
// startDateTime/endDateTime, same as before.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const locationIdParam = searchParams.get("locationId");

  const result = await syncClasses({
    startDateTime: searchParams.get("startDateTime") ?? undefined,
    endDateTime: searchParams.get("endDateTime") ?? undefined,
    locationId: locationIdParam ? Number(locationIdParam) : undefined,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
