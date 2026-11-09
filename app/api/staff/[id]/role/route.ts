import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isClubAdmin, isStaffRole, ROLE_LABELS, type StaffRole } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

// Club admins set a staff member's access: role (Club Admin / Sales Lead /
// Sales / Staff), whether they count as a salesperson, and the Instructor /
// Trainer tags. Only keys present in the body change. See lib/permissions.ts
// for what each grants. Mindbody has no permission concept that maps onto
// this, so this is the only way to grant access short of a direct DB edit.
//
// Admin client throughout: `staff` has a SELECT RLS policy but no UPDATE
// policy, so the club-admin check below is the real authorization boundary.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: staffId } = await params;
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || !isClubAdmin(currentStaff)) {
      return NextResponse.json(
        { success: false, error: "Only a club admin can change staff roles." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const role: unknown = body?.role;
    if (role !== undefined && !isStaffRole(role)) {
      return NextResponse.json({ success: false, error: "Pick a role from the list." }, { status: 400 });
    }
    for (const key of ["canSell", "isInstructor", "isTrainer"] as const) {
      if (body?.[key] !== undefined && typeof body[key] !== "boolean") {
        return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
      }
    }

    const admin = createSupabaseAdminClient();

    const { data: targetStaff, error: staffError } = await admin
      .from("staff")
      .select("id, organization_id, display_name, role, can_sell")
      .eq("id", staffId)
      .maybeSingle();

    if (staffError || !targetStaff || targetStaff.organization_id !== currentStaff.organizationId) {
      return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    }

    const nextRole = (role ?? targetStaff.role) as StaffRole;

    // Demoting the last remaining club admin would lock every admin page
    // (including this one) behind a role only a club admin can grant.
    if (targetStaff.role === "admin" && nextRole !== "admin") {
      const { count, error: countError } = await admin
        .from("staff")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", currentStaff.organizationId)
        .eq("role", "admin")
        .is("archived_at", null);

      if (countError) {
        throw new Error(countError.message);
      }

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          {
            success: false,
            error: `${targetStaff.display_name} is the only ${ROLE_LABELS.admin} -- make someone else a ${ROLE_LABELS.admin} first.`,
          },
          { status: 409 },
        );
      }
    }

    // Sales always count as salespeople. Becoming Sales turns selling on;
    // leaving Sales for Staff turns it off; Club Admins and Sales Leads keep
    // whatever the switch says.
    let canSell: boolean = typeof body?.canSell === "boolean" ? body.canSell : targetStaff.can_sell;
    if (nextRole === "sales") {
      if (body?.canSell === false) {
        return NextResponse.json(
          { success: false, error: "Sales staff always count as salespeople. Change their role to stop." },
          { status: 400 },
        );
      }
      canSell = true;
    } else if (nextRole === "staff" && role !== undefined && targetStaff.role === "sales") {
      canSell = false;
    }

    const update: Record<string, unknown> = { role: nextRole, can_sell: canSell };
    if (typeof body?.isInstructor === "boolean" || typeof body?.isTrainer === "boolean") {
      if (typeof body.isInstructor === "boolean") update.is_instructor = body.isInstructor;
      if (typeof body.isTrainer === "boolean") update.is_trainer = body.isTrainer;
      // Hand-set from now on: the nightly auto-detect leaves this person alone.
      update.teaching_roles_set_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await admin
      .from("staff")
      .update(update)
      .eq("id", staffId)
      .select("role, can_sell, is_instructor, is_trainer")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      success: true,
      role: updated.role,
      canSell: updated.can_sell,
      isInstructor: updated.is_instructor,
      isTrainer: updated.is_trainer,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
