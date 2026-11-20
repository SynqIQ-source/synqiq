import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pushPendingBookings, writebackStudios } from "@/lib/booking/mindbody-push";

export const maxDuration = 300;

// Cron (vercel.json, every 5 minutes): push SynqIQ bookings into Mindbody for
// studios with write-back switched on (and before their cut-off date).
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const results: Record<string, unknown> = {};
  for (const organizationId of await writebackStudios(admin)) {
    try {
      results[organizationId] = await pushPendingBookings(organizationId);
    } catch (error) {
      console.error("[mindbody-push] failed:", error);
      results[organizationId] = { error: true };
    }
  }
  return NextResponse.json({ success: true, pushed: results });
}
