import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadSessionContext } from "@/lib/booking/context";
import { bookingCoverage, bookingWindow, placeFor } from "@/lib/booking/rules";
import { loadCheckInStatus } from "@/lib/checkin/status";

const MEMBERSHIP_PROGRAM = "Memberships & Passes";

// Staff book someone into a class on SynqIQ's calendar. Booked or
// waitlisted depending on spots (Mindbody's bookings + SynqIQ's); what
// covers it is worked out from their live Mindbody services. Nothing
// covering it, or adding someone after the class, needs a reason. Doesn't
// go to Mindbody.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; mindbodyClientId?: unknown; note?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const clientId = typeof body?.mindbodyClientId === "string" ? body.mindbodyClientId : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[\w-]{1,40}$/.test(clientId)) {
    return NextResponse.json({ success: false, error: "Pick a class and a person." }, { status: 400 });
  }
  const orgId = currentStaff.organizationId;
  const [context, person] = await Promise.all([loadSessionContext(orgId, sessionId), loadCheckInStatus(orgId, clientId)]);
  if (!context) return NextResponse.json({ success: false, error: "Class not found." }, { status: 404 });
  if (!person) return NextResponse.json({ success: false, error: "Unknown person." }, { status: 404 });

  // After the class: staff can still add someone (up to a day) with a reason.
  const window = bookingWindow(context.session, context.rules, new Date(), "staff");
  if (!window.open && !(window.overridable && note)) {
    return NextResponse.json({ success: false, error: window.reason, needsReason: Boolean(window.overridable) }, { status: 400 });
  }
  const existing = context.bookings.find((booking) => booking.mindbody_client_id === clientId);
  if (existing && ["booked", "waitlisted", "checked_in"].includes(existing.status)) {
    return NextResponse.json(
      { success: false, error: `${person.client.name} is already ${existing.status === "waitlisted" ? "on the waitlist" : "booked"}.` },
      { status: 400 },
    );
  }
  const coverage = bookingCoverage({
    rules: context.rules,
    services: person.services,
    membershipProgram: MEMBERSHIP_PROGRAM,
    date: context.session.localDate,
    hasCurrentMembership: person.decision.kind === "membership",
  });
  if (coverage.kind === "none" && !note) {
    return NextResponse.json(
      {
        success: false,
        needsReason: true,
        error: `Nothing covers ${context.rules.name} for ${person.client.name}. Add a reason to book anyway.`,
      },
      { status: 400 },
    );
  }
  const status = placeFor(context.session, context.taken);
  const now = new Date().toISOString();
  const row = {
    organization_id: orgId,
    class_session_id: sessionId,
    mindbody_client_id: clientId,
    client_name: person.client.name,
    status,
    waitlisted_at: status === "waitlisted" ? now : null,
    coverage_kind: coverage.kind,
    coverage_name: coverage.name,
    mindbody_client_service_id: coverage.serviceId,
    note: note || null,
    late_cancel_fee_cents: null,
    booked_at: now,
    booked_by_staff_id: currentStaff.id,
    cancelled_at: null,
    cancelled_by_staff_id: null,
    cancel_reason: null,
    checked_in_at: null,
    checked_in_by_staff_id: null,
    updated_at: now,
  };
  const { error } = await createSupabaseAdminClient()
    .from("class_bookings")
    .upsert(row, { onConflict: "class_session_id,mindbody_client_id" });
  if (error) {
    console.error("[bookings] save failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't book. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, status, coverage: coverage.name, standing: person.decision.standing });
}
