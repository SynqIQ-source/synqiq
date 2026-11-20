import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pushPendingBookings } from "@/lib/booking/mindbody-push";

// Club Admins: switch the Mindbody booking write-back on or off, set its
// cut-off date, and (when on) push waiting bookings now.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  if (body?.action === "save") {
    const until = typeof body.until === "string" && DATE.test(body.until) ? body.until : null;
    if (!until) return fail("Pick the last day to copy bookings into Mindbody.");
    const { error } = await admin
      .from("organizations")
      .update({ mindbody_booking_writeback: body.enabled === true, mindbody_writeback_until: until })
      .eq("id", staff.organizationId);
    return error ? fail(error.message, 500) : NextResponse.json({ success: true });
  }
  if (body?.action === "push_now") {
    const result = await pushPendingBookings(staff.organizationId);
    if ("skipped" in result && typeof result.skipped === "string") return fail(`Not pushed: ${result.skipped}.`);
    return NextResponse.json({ success: true, ...result });
  }
  return fail("Unknown action.");
}
