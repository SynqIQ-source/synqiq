import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

const VALID_ROLES = ["admin", "instructor"] as const;
type Role = (typeof VALID_ROLES)[number];

// Promotes/demotes a staff member between 'admin' and 'instructor'. Mindbody
// has no permission concept that maps onto this (see
// 20260716040000_staff_role_and_auth_linkage.sql) -- a staff member's
// Mindbody manager access, if any, was never going to carry over
// automatically, so this is the only way to grant SynqIQ-admin access short of
// a direct DB edit.
//
// Admin client throughout, same reasoning as the invite route: `staff` has a
// SELECT RLS policy but no UPDATE policy at all today, so the explicit role
// check below is the real authorization boundary, not RLS.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: staffId } = await params;
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Only an authenticated admin can change staff roles." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const role: unknown = body?.role;

    if (typeof role !== "string" || !VALID_ROLES.includes(role as Role)) {
      return NextResponse.json(
        { success: false, error: "role must be 'admin' or 'instructor'." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    const { data: targetStaff, error: staffError } = await admin
      .from("staff")
      .select("id, organization_id, display_name, role")
      .eq("id", staffId)
      .maybeSingle();

    if (staffError || !targetStaff) {
      return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    }

    if (targetStaff.organization_id !== currentStaff.organizationId) {
      return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    }

    // Demoting the last remaining admin would permanently lock every admin
    // page (including this one) behind a role only an admin can grant --
    // there'd be no way back in short of a direct DB edit, the exact
    // situation this route exists to avoid.
    if (targetStaff.role === "admin" && role === "instructor") {
      const { count, error: countError } = await admin
        .from("staff")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", currentStaff.organizationId)
        .eq("role", "admin");

      if (countError) {
        throw new Error(countError.message);
      }

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          {
            success: false,
            error: `${targetStaff.display_name} is the only remaining admin -- promote someone else to admin first.`,
          },
          { status: 409 },
        );
      }
    }

    const { error: updateError } = await admin.from("staff").update({ role }).eq("id", staffId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ success: true, role });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
