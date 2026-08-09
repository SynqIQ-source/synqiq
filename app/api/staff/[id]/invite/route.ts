import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestOrigin } from "@/lib/request-origin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RouteParams = { params: Promise<{ id: string }> };

// Links a staff row to a real Synq login via Supabase's invite flow.
// Admin client throughout, same reasoning as trainer-health-settings and
// branding routes: `staff` has a SELECT RLS policy but no UPDATE policy at
// all today, so the explicit role check below is the real authorization
// boundary, not RLS.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: staffId } = await params;
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Only an authenticated admin can invite a staff member." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const emailOverride: unknown = body?.email;
    const confirmRelink: unknown = body?.confirmRelink;

    const admin = createSupabaseAdminClient();

    const { data: targetStaff, error: staffError } = await admin
      .from("staff")
      .select("id, organization_id, display_name, email, auth_user_id")
      .eq("id", staffId)
      .maybeSingle();

    if (staffError || !targetStaff) {
      return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    }

    if (targetStaff.organization_id !== currentStaff.organizationId) {
      return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    }

    // Already linked: only proceed with an explicit confirmRelink flag,
    // sent only after the admin has confirmed a "this will replace their
    // existing login" prompt in the UI -- an accidental re-invite must
    // never silently sever a working login.
    if (targetStaff.auth_user_id && confirmRelink !== true) {
      return NextResponse.json(
        {
          success: false,
          error: `${targetStaff.display_name} already has a linked login. Confirm to send a new invite anyway.`,
          alreadyLinked: true,
        },
        { status: 409 },
      );
    }

    const email = typeof emailOverride === "string" && emailOverride.trim() ? emailOverride.trim() : targetStaff.email;

    if (!email || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { success: false, error: "A valid email address is required to send an invite." },
        { status: 400 },
      );
    }

    const origin = resolveRequestOrigin(request);
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/confirm`,
    });

    if (inviteError || !inviteData?.user) {
      return NextResponse.json(
        { success: false, error: inviteError?.message ?? "Failed to send invite." },
        { status: 502 },
      );
    }

    const { error: linkError } = await admin
      .from("staff")
      .update({ auth_user_id: inviteData.user.id, email })
      .eq("id", staffId);

    if (linkError) {
      throw new Error(linkError.message);
    }

    return NextResponse.json({ success: true, email });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
