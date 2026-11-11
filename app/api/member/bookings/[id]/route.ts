import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findStudio, getCurrentMember, sameOrigin } from "@/lib/member/session";
import { loadSessionContext } from "@/lib/booking/context";
import { decideCancel } from "@/lib/booking/rules";

type RouteParams = { params: Promise<{ id: string }> };

// A member cancels their own booking or leaves the waitlist. Inside the
// program's window it's a late cancel (with the program's fee noted; not
// charged until payments move to SynqIQ). Members can't waive it.
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { studio?: unknown } | null;
  const studio = await findStudio(Number(body?.studio));
  if (!studio) return NextResponse.json({ success: false, error: "Studio not found." }, { status: 404 });
  const member = await getCurrentMember(studio);
  if (!member) return NextResponse.json({ success: false, error: "Sign in first.", signIn: true }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data: booking } = await admin
    .from("class_bookings")
    .select("id, class_session_id, status")
    .eq("id", id)
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", member.mindbodyClientId)
    .maybeSingle();
  if (!booking) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const context = await loadSessionContext(studio.id, booking.class_session_id as string);
  if (!context) return NextResponse.json({ success: false, error: "Class not found." }, { status: 404 });
  const now = new Date();
  if (now.getTime() >= Date.parse(context.session.startsAt)) {
    return NextResponse.json({ success: false, error: "This class has started. Please talk to the front desk." }, { status: 400 });
  }
  const outcome = decideCancel({ status: booking.status as string, session: context.session, rules: context.rules, now, canWaive: false });
  if (!outcome.ok) return NextResponse.json({ success: false, error: outcome.error }, { status: 400 });
  const { error } = await admin
    .from("class_bookings")
    .update({
      status: outcome.status,
      late_cancel_fee_cents: outcome.feeCents,
      cancelled_at: now.toISOString(),
      cancelled_by_member_account_id: member.accountId,
      cancel_reason: booking.status === "waitlisted" ? "Left the waitlist online" : "Cancelled online",
      updated_at: now.toISOString(),
    })
    .eq("id", id)
    .eq("status", booking.status as string);
  if (error) {
    console.error("[member-bookings] cancel failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't cancel. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, status: outcome.status, feeCents: outcome.feeCents });
}
