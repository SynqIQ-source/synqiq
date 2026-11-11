import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn, isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

// Undo a check-in made by mistake (kept, marked void with who and why).
// Front desk staff can undo today's; Club Admins any.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) return NextResponse.json({ success: false, error: "Add a reason." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle();
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;
  let update = admin
    .from("check_ins")
    .update({ voided_at: new Date().toISOString(), voided_by_staff_id: currentStaff.id, void_reason: reason })
    .eq("id", id)
    .eq("organization_id", currentStaff.organizationId)
    .is("voided_at", null);
  if (!isClubAdmin(currentStaff)) update = update.eq("local_date", today);
  const { data, error } = await update.select("id");
  if (error) {
    console.error("[check-in] void failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't undo. Try again." }, { status: 500 });
  }
  if (!data?.length) return NextResponse.json({ success: false, error: "Already undone, not from today, or not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
