import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shiftProblem } from "@/lib/time-clock/hours";
import { fromLocalInput } from "@/lib/time-clock/local-time";

// Club Admin adds a missed shift (with a reason, kept in the audit log).
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    staffId?: unknown;
    clockIn?: unknown;
    clockOut?: unknown;
    reason?: unknown;
  } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const staffId = typeof body?.staffId === "string" ? body.staffId : "";
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) return NextResponse.json({ success: false, error: "Pick a person." }, { status: 400 });
  if (!reason) return NextResponse.json({ success: false, error: "Add a reason." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const [{ data: org }, { data: person }] = await Promise.all([
    admin.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle(),
    admin.from("staff").select("id").eq("id", staffId).eq("organization_id", currentStaff.organizationId).maybeSingle(),
  ]);
  if (!person) return NextResponse.json({ success: false, error: "Person not found." }, { status: 404 });
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const clockIn = fromLocalInput(body?.clockIn, timezone);
  const clockOut = fromLocalInput(body?.clockOut, timezone);
  if (!clockIn || !clockOut) return NextResponse.json({ success: false, error: "Enter both times." }, { status: 400 });
  const problem = shiftProblem(clockIn, clockOut, new Date());
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

  const { data: punch, error } = await admin
    .from("time_punches")
    .insert({
      organization_id: currentStaff.organizationId,
      staff_id: staffId,
      clock_in_at: clockIn,
      clock_out_at: clockOut,
      source: "admin",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[time-clock] add failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  await admin.from("time_punch_edits").insert({
    organization_id: currentStaff.organizationId,
    punch_id: punch.id,
    edited_by_staff_id: currentStaff.id,
    action: "add",
    before: null,
    after: { clock_in_at: clockIn, clock_out_at: clockOut },
    reason,
  });
  return NextResponse.json({ success: true });
}
