import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isClubAdmin } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admins reset a staff member's two-step sign-in (lost or replaced
// phone): removes every authenticator on their login, which also signs them
// out everywhere. They sign in with their password and can set it up again.
// A Club Admin can't reset their own here (someone else has to), so one
// stolen password can't be used to remove the second step.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id: staffId } = await params;
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  if (staffId === currentStaff.id) {
    return NextResponse.json(
      { success: false, error: "Ask another Club Admin to reset your own two-step sign-in." },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("staff")
    .select("id, organization_id, auth_user_id")
    .eq("id", staffId)
    .maybeSingle();
  if (!target || target.organization_id !== currentStaff.organizationId) {
    return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
  }
  if (!target.auth_user_id) {
    return NextResponse.json({ success: false, error: "This person has no login yet." }, { status: 400 });
  }

  const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: target.auth_user_id });
  if (listError) {
    console.error("[two-step-reset] list failed:", listError.message);
    return NextResponse.json({ success: false, error: "Couldn't reset. Try again." }, { status: 500 });
  }
  for (const factor of factors?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.auth_user_id });
    if (deleteError) {
      console.error("[two-step-reset] delete failed:", deleteError.message);
      return NextResponse.json({ success: false, error: "Couldn't reset. Try again." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, removed: factors?.factors.length ?? 0 });
}
