import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  findStaffReferences,
  loadManageableStaff,
  removeEligibility,
  revokeStaffLogin,
  wouldOrphanAdmins,
} from "@/lib/staff/lifecycle";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE -- permanently remove a staff member who should never have been in
// SynqIQ (a front-desk person MindBody handed us as an instructor). Only
// goes through when the row has NO references anywhere; a real instructor
// with history is told to archive instead. Also drops a
// staff_sync_exclusions row so the nightly roster sync doesn't re-create
// them, and revokes their login.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: staffId } = await params;
    const currentStaff = await getCurrentStaff();
    const admin = createSupabaseAdminClient();

    const guard = await loadManageableStaff(admin, currentStaff, staffId);
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }
    const { target } = guard;

    if (await wouldOrphanAdmins(admin, currentStaff!.organizationId, target)) {
      return NextResponse.json(
        {
          success: false,
          error: `${target.display_name} is the only active admin -- promote someone else first.`,
        },
        { status: 409 },
      );
    }

    const references = await findStaffReferences(admin, staffId);
    if (references.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `${target.display_name} has activity in SynqIQ (${references.join(", ")}) and can't be permanently deleted. Archive them instead.`,
          references,
        },
        { status: 409 },
      );
    }

    // Exclusion first: if the row somehow still won't delete, better that
    // it's sync-excluded (and archivable) than that it silently re-appears
    // on the next roster sync.
    if (target.mindbody_staff_id != null) {
      const { error: exclusionError } = await admin.from("staff_sync_exclusions").upsert(
        {
          organization_id: target.organization_id,
          mindbody_staff_id: target.mindbody_staff_id,
          excluded_by: currentStaff!.id,
          reason: "Deleted from Staff Logins (not an instructor).",
        },
        { onConflict: "organization_id,mindbody_staff_id" },
      );

      if (exclusionError) {
        throw new Error(`Could not record the sync exclusion: ${exclusionError.message}`);
      }
    }

    await revokeStaffLogin(admin, target.auth_user_id);
    // Drop off the Class Eligibility page too -- see removeEligibility.
    // Deliberately after the reference check above, not before: if that
    // check blocks the delete, this staff member is staying, and their
    // eligibility toggles must stay with them.
    await removeEligibility(admin, staffId);

    const { error: deleteError } = await admin.from("staff").delete().eq("id", staffId);
    if (deleteError) {
      // A reference the pre-check doesn't know about. The exclusion above
      // still stands, so guide the admin to the fallback.
      return NextResponse.json(
        {
          success: false,
          error: `${target.display_name} still has linked records and can't be fully deleted -- archive them instead. (${deleteError.message})`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
