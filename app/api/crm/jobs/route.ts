import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runDueJobs } from "@/lib/crm/jobs";
import { logCrmError } from "@/lib/crm/http";

export const maxDuration = 300;

// Cron (vercel.json): retries CRM background jobs that didn't finish right
// after check-in -- e.g. Mailgun was down or the key wasn't set yet.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDueJobs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logCrmError("crm/jobs cron", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
