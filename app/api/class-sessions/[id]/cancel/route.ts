import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { managesSales } from "@/lib/permissions";
import { cancelClassSession } from "@/lib/booking/cancel-class";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admins and Sales Leads cancel one class date: it stops being
// bookable, SynqIQ bookings and waitlist spots are released (no late cancel
// or fee) and those members are emailed. Mindbody isn't changed.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff || !managesSales(staff)) {
    return NextResponse.json({ success: false, error: "Only Club Admins and Sales Leads can cancel a class." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Class not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (!reason) return NextResponse.json({ success: false, error: "Add a reason (kept for staff; members don't see it)." }, { status: 400 });
  const result = await cancelClassSession({ organizationId: staff.organizationId, sessionId: id, staffId: staff.id, reason });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, cancelledBookings: result.cancelledBookings, emailed: result.emailed });
}
