import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createMindbodyClient } from "@/lib/mindbody/client";

// Debugging only: live Mindbody data, so it needs the cron secret.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mindbodyClient = createMindbodyClient();
  const classes = await mindbodyClient.getClasses();

  return NextResponse.json(classes);
}
