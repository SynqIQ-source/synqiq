import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shiftProblem } from "@/lib/time-clock/hours";
import { fromLocalInput } from "@/lib/time-clock/local-time";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admin fixes a shift (times, a missed clock-out) or removes it. Every
// change is logged with the before/after and a reason.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    clockIn?: unknown;
    clockOut?: unknown;
    reason?: unknown;
    remove?: unknown;
  } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) return NextResponse.json({ success: false, error: "Add a reason." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const [{ data: org }, { data: punch }] = await Promise.all([
    admin.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle(),
    admin
      .from("time_punches")
      .select("id, clock_in_at, clock_out_at")
      .eq("id", id)
      .eq("organization_id", currentStaff.organizationId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (!punch) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const before = { clock_in_at: punch.clock_in_at, clock_out_at: punch.clock_out_at };
  const now = new Date();

  let after: Record<string, unknown>;
  let action: "edit" | "delete";
  if (body?.remove === true) {
    action = "delete";
    after = { deleted_at: now.toISOString() };
  } else {
    const timezone = (org?.timezone as string | null) ?? "America/Chicago";
    const clockIn = fromLocalInput(body?.clockIn, timezone);
    const hasOut = typeof body?.clockOut === "string" && body.clockOut !== "";
    const clockOut = hasOut ? fromLocalInput(body?.clockOut, timezone) : null;
    if (!clockIn) return NextResponse.json({ success: false, error: "Enter the clock-in time." }, { status: 400 });
    if (hasOut && !clockOut) return NextResponse.json({ success: false, error: "Enter a valid clock-out time." }, { status: 400 });
    const problem = shiftProblem(clockIn, clockOut, now);
    if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
    action = "edit";
    after = { clock_in_at: clockIn, clock_out_at: clockOut };
  }
  const { error } = await admin
    .from("time_punches")
    .update({ ...after, updated_at: now.toISOString() })
    .eq("id", id);
  if (error) {
    console.error("[time-clock] edit failed:", error.message);
    return NextResponse.json(
      { success: false, error: error.code === "23505" ? "They already have an open shift." : "Couldn't save. Try again." },
      { status: 500 },
    );
  }
  await admin.from("time_punch_edits").insert({
    organization_id: currentStaff.organizationId,
    punch_id: id,
    edited_by_staff_id: currentStaff.id,
    action,
    before,
    after,
    reason,
  });
  return NextResponse.json({ success: true });
}
