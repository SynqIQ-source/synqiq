import { NextRequest, NextResponse } from "next/server";
import { findStudio, getCurrentMember } from "@/lib/member/session";
import { loadSessionContext } from "@/lib/booking/context";

// A signed-in member's spot picker for a class: the room's layout, which
// spots are taken (ids only -- never who), and the member's own spot.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sessionId = params.get("sessionId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return NextResponse.json({ success: false, error: "Pick a class." }, { status: 400 });
  const studio = await findStudio(Number(params.get("studio")));
  if (!studio) return NextResponse.json({ success: false, error: "Studio not found." }, { status: 404 });
  const member = await getCurrentMember(studio);
  if (!member) return NextResponse.json({ success: false, error: "Sign in first.", signIn: true }, { status: 401 });
  const context = await loadSessionContext(studio.id, sessionId);
  if (!context) return NextResponse.json({ success: false, error: "Class not found." }, { status: 404 });
  if (!context.layout) return NextResponse.json({ success: true, layout: null });
  const mine = context.bookings.find(
    (booking) => booking.mindbody_client_id === member.mindbodyClientId && ["booked", "checked_in"].includes(booking.status),
  );
  return NextResponse.json(
    { success: true, layout: context.layout, taken: [...context.takenSpots], mine: mine?.spot_id ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
