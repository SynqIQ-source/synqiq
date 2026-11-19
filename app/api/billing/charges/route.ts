import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { moveChargeDate, retryChargeNow } from "@/lib/billing/renewal-job";

// Club Admins: retry a declined monthly payment now, or move one billing date
// (a declined charge's next try, or an upcoming payment) to another day.
const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chargeId = typeof body?.chargeId === "string" && UUID.test(body.chargeId) ? body.chargeId : null;
  const scheduleId = typeof body?.scheduleId === "string" && UUID.test(body.scheduleId) ? body.scheduleId : null;
  const dueDate = typeof body?.dueDate === "string" && DATE.test(body.dueDate) ? body.dueDate : null;
  const date = typeof body?.date === "string" ? body.date : "";

  if (body?.action === "retry") {
    if (!chargeId) return NextResponse.json({ success: false, error: "Charge not found." }, { status: 400 });
    const result = await retryChargeNow(staff.organizationId, chargeId);
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, outcome: result.outcome });
  }
  if (body?.action === "move") {
    const target = chargeId ? { chargeId } : scheduleId && dueDate ? { scheduleId, dueDate } : null;
    if (!target) return NextResponse.json({ success: false, error: "Charge not found." }, { status: 400 });
    const result = await moveChargeDate(staff.organizationId, staff.id, target, date);
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
