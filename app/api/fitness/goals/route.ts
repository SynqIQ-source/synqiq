import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;

// Reads a goal: blank = no goal; otherwise a whole number in range.
function goal(raw: unknown, max: number): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value < 0 || value > max) return { ok: false };
  return { ok: true, value };
}

// PUT /api/fitness/goals { month: "yyyy-MM-01", sessions, sales (dollars) }:
// the club's personal-training goals for a month (Fitness Dashboard).
// Club Admins only.
export async function PUT(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff))
    return NextResponse.json({ success: false, error: "Only a Club Admin can set goals." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const month = typeof body?.month === "string" && MONTH_PATTERN.test(body.month) ? body.month : null;
  if (!month) return NextResponse.json({ success: false, error: "Pick a month." }, { status: 400 });
  const sessions = goal(body?.sessions, 100_000);
  if (!sessions.ok)
    return NextResponse.json({ success: false, error: "Sessions goal must be a number from 0 to 100,000." }, { status: 400 });
  const sales = goal(body?.sales, 1_000_000_000);
  if (!sales.ok) return NextResponse.json({ success: false, error: "PT sales goal must be a dollar amount." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("fitness_goals").upsert(
    {
      organization_id: staff.organizationId,
      month,
      sessions_goal: sessions.value == null ? null : Math.round(sessions.value),
      sales_goal_cents: sales.value == null ? null : Math.round(sales.value * 100),
      updated_by_staff_id: staff.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,month" },
  );
  if (error) return NextResponse.json({ success: false, error: "Couldn't save the goals. Try again." }, { status: 500 });
  return NextResponse.json({ success: true });
}
