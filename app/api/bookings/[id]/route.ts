import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadSessionContext } from "@/lib/booking/context";
import { decideCancel, placeFor } from "@/lib/booking/rules";
import { chooseSpot } from "@/lib/rooms/layout";

type RouteParams = { params: Promise<{ id: string }> };
type Action = "cancel" | "check_in" | "no_show" | "move_in" | "move_spot";

// Change a booking: cancel (on time or late; the program's window decides
// by default and staff can override either way, with a reason that's
// saved), check in, mark no-show, or move someone in from the waitlist
// (over capacity too, when staff choose), or move someone to another spot
// in a pick-a-spot room.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    reason?: unknown;
    kind?: unknown;
    waiveLateCancel?: unknown;
    overCapacity?: unknown;
    spotId?: unknown;
  } | null;
  const spotRequested = typeof body?.spotId === "string" && body.spotId ? body.spotId.slice(0, 40) : null;
  const action = body?.action as Action;
  if (!["cancel", "check_in", "no_show", "move_in", "move_spot"].includes(action)) {
    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const admin = createSupabaseAdminClient();
  const { data: booking } = await admin
    .from("class_bookings")
    .select("id, class_session_id, status")
    .eq("id", id)
    .eq("organization_id", currentStaff.organizationId)
    .maybeSingle();
  if (!booking) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const context = await loadSessionContext(currentStaff.organizationId, booking.class_session_id as string);
  if (!context) return NextResponse.json({ success: false, error: "Class not found." }, { status: 404 });
  const now = new Date();
  const started = now.getTime() >= Date.parse(context.session.startsAt);
  const status = booking.status as string;
  let update: Record<string, unknown>;

  if (action === "cancel") {
    if (!reason) return NextResponse.json({ success: false, error: "Add a reason." }, { status: 400 });
    const requested =
      body?.kind === "late" || body?.kind === "on_time"
        ? (body.kind as "late" | "on_time")
        : body?.waiveLateCancel === true
          ? "on_time"
          : undefined;
    const outcome = decideCancel({
      status,
      session: context.session,
      rules: context.rules,
      now,
      requested,
      canWaive: true, // staff who manage bookings can override either way (logged)
    });
    if (!outcome.ok) return NextResponse.json({ success: false, error: outcome.error }, { status: 400 });
    update = {
      status: outcome.status,
      late_cancel_fee_cents: outcome.feeCents,
      cancelled_at: now.toISOString(),
      cancelled_by_staff_id: currentStaff.id,
      cancel_reason: outcome.waived ? `${reason} (late cancel waived)` : reason,
    };
  } else if (action === "check_in") {
    if (!["booked", "no_show"].includes(status))
      return NextResponse.json({ success: false, error: "Only booked people can be checked in." }, { status: 400 });
    update = { status: "checked_in", checked_in_at: now.toISOString(), checked_in_by_staff_id: currentStaff.id };
  } else if (action === "no_show") {
    if (status !== "booked") return NextResponse.json({ success: false, error: "Only booked people can be no-shows." }, { status: 400 });
    if (!started) return NextResponse.json({ success: false, error: "The class hasn't started yet." }, { status: 400 });
    update = { status: "no_show" };
  } else if (action === "move_spot") {
    if (!context.layout) return NextResponse.json({ success: false, error: "This room has no spots." }, { status: 400 });
    if (status !== "booked" && status !== "checked_in")
      return NextResponse.json({ success: false, error: "Only booked people have a spot." }, { status: 400 });
    if (!spotRequested) return NextResponse.json({ success: false, error: "Pick a spot." }, { status: 400 });
    const chosen = chooseSpot(context.layout, context.takenSpots, spotRequested);
    if (!chosen.spot) return NextResponse.json({ success: false, error: chosen.error ?? "That spot is taken." }, { status: 400 });
    update = { spot_id: chosen.spot.id, spot_label: `${context.layout.spotNoun} ${chosen.spot.label}` };
  } else {
    if (status !== "waitlisted") return NextResponse.json({ success: false, error: "They're not on the waitlist." }, { status: 400 });
    const overCapacity = body?.overCapacity === true;
    if (!overCapacity && placeFor(context.session, context.taken) !== "booked")
      return NextResponse.json({ success: false, error: "The class is still full." }, { status: 400 });
    update = { status: "booked", waitlisted_at: null };
    // Pick-a-spot rooms: give them the spot asked for or the next free one
    // (none free and staff chose over capacity: booked without a spot).
    if (context.layout) {
      const chosen = chooseSpot(context.layout, context.takenSpots, spotRequested);
      if (chosen.error) return NextResponse.json({ success: false, error: chosen.error }, { status: 400 });
      if (!chosen.spot && !overCapacity)
        return NextResponse.json({ success: false, error: `Every ${context.layout.spotNoun.toLowerCase()} is taken.` }, { status: 400 });
      if (chosen.spot) update = { ...update, spot_id: chosen.spot.id, spot_label: `${context.layout.spotNoun} ${chosen.spot.label}` };
    }
  }

  const { error } = await admin
    .from("class_bookings")
    .update({ ...update, updated_at: now.toISOString() })
    .eq("id", id)
    .eq("status", status); // nobody changed it in the meantime
  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ success: false, error: "That spot was just taken. Pick another." }, { status: 409 });
    console.error("[bookings] update failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, status: update.status ?? status });
}
