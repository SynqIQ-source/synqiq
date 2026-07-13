import { NextRequest, NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { asOccurrenceId } from "@/lib/mindbody/types";

export async function GET(request: NextRequest) {
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
