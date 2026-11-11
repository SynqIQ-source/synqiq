import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findStudio, getCurrentMember, sameOrigin } from "@/lib/member/session";
import { loadSessionContext } from "@/lib/booking/context";
import { bookingCoverage, bookingWindow, placeFor } from "@/lib/booking/rules";
import { loadCheckInStatus } from "@/lib/checkin/status";

const MEMBERSHIP_PROGRAM = "Memberships & Passes";

// A signed-in member books themselves into a class: the member booking
// window, and something on their account has to cover it (membership or a
// pack in the class's program, read live from Mindbody). Full -> waitlist.
// SynqIQ only; Mindbody isn't changed.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { studio?: unknown; sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return NextResponse.json({ success: false, error: "Pick a class." }, { status: 400 });
  const studio = await findStudio(Number(body?.studio));
  if (!studio) return NextResponse.json({ success: false, error: "Studio not found." }, { status: 404 });
  const member = await getCurrentMember(studio);
  if (!member) return NextResponse.json({ success: false, error: "Sign in to book.", signIn: true }, { status: 401 });

  const [context, person] = await Promise.all([
    loadSessionContext(studio.id, sessionId),
    loadCheckInStatus(studio.id, member.mindbodyClientId),
  ]);
  if (!context) return NextResponse.json({ success: false, error: "Class not found." }, { status: 404 });
  if (!person)
    return NextResponse.json({ success: false, error: "We couldn't find your account. Please contact the front desk." }, { status: 404 });
  const window = bookingWindow(context.session, context.rules, new Date(), "member");
  if (!window.open) return NextResponse.json({ success: false, error: window.reason }, { status: 400 });
  const existing = context.bookings.find((booking) => booking.mindbody_client_id === member.mindbodyClientId);
  if (existing && ["booked", "waitlisted", "checked_in"].includes(existing.status)) {
    return NextResponse.json(
      { success: false, error: existing.status === "waitlisted" ? "You're already on the waitlist." : "You're already booked." },
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
  if (coverage.kind === "none") {
    return NextResponse.json(
      {
        success: false,
        error: context.rules.includedInMembership
          ? "Nothing on your account covers this class. Please contact the front desk."
          : `${context.rules.name} needs a ${context.rules.name} package. Please contact the front desk to buy one.`,
      },
      { status: 400 },
    );
  }

  const status = placeFor(context.session, context.taken);
  const now = new Date().toISOString();
  const { error } = await createSupabaseAdminClient()
    .from("class_bookings")
    .upsert(
      {
        organization_id: studio.id,
        class_session_id: sessionId,
        mindbody_client_id: member.mindbodyClientId,
        client_name: person.client.name,
        status,
        waitlisted_at: status === "waitlisted" ? now : null,
        coverage_kind: coverage.kind,
        coverage_name: coverage.name,
        mindbody_client_service_id: coverage.serviceId,
        note: null,
        late_cancel_fee_cents: null,
        booked_at: now,
        booked_by_staff_id: null,
        booked_by_member_account_id: member.accountId,
        cancelled_at: null,
        cancelled_by_staff_id: null,
        cancelled_by_member_account_id: null,
        cancel_reason: null,
        checked_in_at: null,
        checked_in_by_staff_id: null,
        updated_at: now,
      },
      { onConflict: "class_session_id,mindbody_client_id" },
    );
  if (error) {
    console.error("[member-bookings] save failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't book. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, status });
}
