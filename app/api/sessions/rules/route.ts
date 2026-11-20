import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Club Admins: PT session rules (does a no-show / late cancel use a session)
// and the date SynqIQ's session balances stop following Mindbody.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const from = typeof body?.balancesFrom === "string" && DATE.test(body.balancesFrom) ? body.balancesFrom : null;
  if (!from) return NextResponse.json({ success: false, error: "Pick the switch date." }, { status: 400 });
  const { error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({
      pt_no_show_uses_session: body?.noShow !== false,
      pt_late_cancel_uses_session: body?.lateCancel !== false,
      session_balances_from: from,
    })
    .eq("id", staff.organizationId);
  return error ? NextResponse.json({ success: false, error: error.message }, { status: 500 }) : NextResponse.json({ success: true });
}
