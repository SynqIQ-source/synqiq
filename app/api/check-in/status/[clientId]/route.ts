import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { loadCheckInStatus } from "@/lib/checkin/status";

type RouteParams = { params: Promise<{ clientId: string }> };

// What covers a check-in for this person right now (live from Mindbody).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { clientId: raw } = await params;
  const clientId = decodeURIComponent(raw);
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  if (!/^[\w-]{1,40}$/.test(clientId)) return NextResponse.json({ success: false, error: "Unknown person." }, { status: 404 });
  const status = await loadCheckInStatus(currentStaff.organizationId, clientId);
  if (!status) return NextResponse.json({ success: false, error: "Unknown person." }, { status: 404 });
  return NextResponse.json({ success: true, status });
}
