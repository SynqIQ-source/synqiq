import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { sendDueNewsletters } from "@/lib/email/newsletters";

export const maxDuration = 300;

// Cron (vercel.json, every 10 minutes): sends newsletters whose scheduled
// time has come. Nothing is sent unless a Club Admin scheduled it.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ success: true, newsletters: await sendDueNewsletters() });
  } catch (error) {
    console.error("[newsletters] send failed:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
