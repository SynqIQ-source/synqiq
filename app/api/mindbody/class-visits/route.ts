import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { asOccurrenceId } from "@/lib/mindbody/types";

// Debugging only: live Mindbody data, so it needs the cron secret.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const occurrenceIdParam = request.nextUrl.searchParams.get("occurrenceId");

  if (!occurrenceIdParam || Number.isNaN(Number(occurrenceIdParam))) {
    return NextResponse.json(
      { error: "occurrenceId query parameter (MindBody class instance Id) is required." },
      { status: 400 },
    );
  }

  const mindbodyClient = createMindbodyClient();
  const visits = await mindbodyClient.getClassVisits(asOccurrenceId(Number(occurrenceIdParam)));

  return NextResponse.json(visits);
}
