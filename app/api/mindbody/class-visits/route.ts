import { NextRequest, NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";

export async function GET(request: NextRequest) {
  const classId = request.nextUrl.searchParams.get("classId");

  if (!classId) {
    return NextResponse.json(
      { error: "classId query parameter is required." },
      { status: 400 },
    );
  }

  const mindbodyClient = createMindbodyClient();
  const visits = await mindbodyClient.getClassVisits(classId);

  return NextResponse.json(visits);
}
