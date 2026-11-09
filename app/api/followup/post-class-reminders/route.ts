import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { runPostClassReminders } from "@/lib/followup/post-class-reminders";

// One Mindbody visits call per class since the last run (a morning's or
// afternoon's worth); 300s is headroom for a busy day.
export const maxDuration = 300;

// Cron (vercel.json), hourly: does work only when it's noon or 8 PM in a
// studio's own time zone -- see lib/followup/post-class-reminders.ts.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runPostClassReminders();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[post-class-reminders] Run failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
