import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Club Admins: PT session rules -- the trainer sessions pilot switch, whether
// a no-show / late cancel uses a session and what share of the trainer's pay
// it earns, and the date SynqIQ's session balances stop following Mindbody.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const percent = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
};

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const from = typeof body?.balancesFrom === "string" && DATE.test(body.balancesFrom) ? body.balancesFrom : null;
  if (!from) return NextResponse.json({ success: false, error: "Pick the switch date." }, { status: 400 });
  const noShowPay = percent(body?.noShowPayPercent ?? 100);
  const lateCancelPay = percent(body?.lateCancelPayPercent ?? 100);
  if (noShowPay == null || lateCancelPay == null)
    return NextResponse.json({ success: false, error: "Pay percents are whole numbers from 0 to 100." }, { status: 400 });
  const { error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({
      pt_no_show_uses_session: body?.noShow !== false,
      pt_late_cancel_uses_session: body?.lateCancel !== false,
      pt_no_show_pay_percent: noShowPay,
      pt_late_cancel_pay_percent: lateCancelPay,
      session_balances_from: from,
      ...(typeof body?.pilot === "boolean" ? { trainer_sessions_pilot: body.pilot } : {}),
    })
    .eq("id", staff.organizationId);
  return error ? NextResponse.json({ success: false, error: error.message }, { status: 500 }) : NextResponse.json({ success: true });
}
