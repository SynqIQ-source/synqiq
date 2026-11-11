import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { signsOutOnClockOut } from "@/lib/time-clock/hours";

// Clock yourself in or out. Clocking out tells Staff and Sales to sign out
// (the browser does it); instructors, trainers and Club Admins stay in.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff) return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "in" && action !== "out") return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data: open } = await admin
    .from("time_punches")
    .select("id, clock_in_at")
    .eq("staff_id", currentStaff.id)
    .is("clock_out_at", null)
    .is("deleted_at", null)
    .maybeSingle();

  if (action === "in") {
    if (open) return NextResponse.json({ success: true, clockedInAt: open.clock_in_at });
    const { data, error } = await admin
      .from("time_punches")
      .insert({ organization_id: currentStaff.organizationId, staff_id: currentStaff.id, clock_in_at: now, source: "clock" })
      .select("clock_in_at")
      .single();
    if (error) {
      console.error("[time-clock] clock in failed:", error.message);
      return NextResponse.json({ success: false, error: "Couldn't clock in. Try again." }, { status: 500 });
    }
    return NextResponse.json({ success: true, clockedInAt: data.clock_in_at });
  }

  if (!open) return NextResponse.json({ success: true, signOut: signsOutOnClockOut(currentStaff) });
  const { error } = await admin
    .from("time_punches")
    .update({ clock_out_at: now, updated_at: now })
    .eq("id", open.id)
    .is("clock_out_at", null);
  if (error) {
    console.error("[time-clock] clock out failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't clock out. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, signOut: signsOutOnClockOut(currentStaff) });
}
