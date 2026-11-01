import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createMindbodyClient } from "@/lib/mindbody/client";

// Debugging only: live Mindbody data, so it needs the cron secret.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mindbodyClient = createMindbodyClient();
  const staff = await mindbodyClient.getStaff();

  return NextResponse.json(staff);
}
