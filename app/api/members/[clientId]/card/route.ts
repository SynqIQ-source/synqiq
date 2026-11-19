import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canViewMembers } from "@/lib/permissions";
import { finishCardUpdate, startCardUpdate } from "@/lib/billing/cards";
import { sendCardLink } from "@/lib/billing/notify";

// Staff (Club Admins, Sales Leads, Sales) update a member's card on file at
// the desk, or email the member a secure link to do it themselves.
export async function POST(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || !canViewMembers(staff)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const clientId = decodeURIComponent((await params).clientId);
  if (!/^[\w-]{1,40}$/.test(clientId)) return NextResponse.json({ success: false, error: "Member not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.action === "start") {
    const result = await startCardUpdate(staff.organizationId, clientId, "desk", staff.id);
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  if (body?.action === "finish") {
    const result = await finishCardUpdate(String(body.setupIntentId ?? ""), { organizationId: staff.organizationId, clientId });
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  if (body?.action === "email") {
    const result = await sendCardLink(staff.organizationId, clientId, staff.id);
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, email: result.email });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
