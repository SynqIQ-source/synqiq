import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailVendor, loadIssue } from "@/lib/maintenance/server";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admins only: approve contacting a vendor (the first email) and keep
// the conversation going. Replies come back to the report's timeline.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin") {
    return NextResponse.json({ success: false, error: "Only a Club Admin can contact a vendor." }, { status: 403 });
  }
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const loaded = await loadIssue(admin, staff.organizationId, id);
  if (!loaded) return NextResponse.json({ success: false, error: "Report not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { vendorId?: unknown; message?: unknown } | null;
  const vendorId = typeof body?.vendorId === "string" && /^[0-9a-f-]{36}$/i.test(body.vendorId) ? body.vendorId : null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 6000) : "";
  if (!vendorId) return NextResponse.json({ success: false, error: "Pick a vendor." }, { status: 400 });
  if (!message) return NextResponse.json({ success: false, error: "Write a message to the vendor." }, { status: 400 });
  const result = await emailVendor(admin, {
    issue: loaded.issue,
    equipment: loaded.equipment,
    vendorId,
    message,
    staff: { id: staff.id, displayName: staff.displayName },
  });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, vendor: result.vendorName });
}
