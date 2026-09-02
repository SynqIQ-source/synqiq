import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClasses } from "@/lib/sync/classes";

// Thin wrapper -- see lib/sync/classes.ts for the actual sync logic (which
// carries its own DST-safe "already ran today" gate, keyed off
// class_occurrences.sync_timestamp). Its own two cron firings in
// vercel.json, and still shared with app/api/sync/all as the manual
// "run everything" route.
export const maxDuration = 120;

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
