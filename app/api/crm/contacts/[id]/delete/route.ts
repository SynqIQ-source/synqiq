import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Admin "Delete guest": hides the guest from every list, duplicate match and
// kiosk lookup, recording who and when. The row itself is kept (enforced in
// the database): signed waivers must be kept indefinitely and point at it.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Guest not found.", 404);

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("crm_contacts")
      .update({ deleted_at: now, deleted_by_staff_id: staff.id, updated_at: now })
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .select("id");
    if (error) throw error;
    if (!data?.length) return jsonError("Guest not found.", 404);

    // Duplicate items about this guest no longer need a decision.
    await admin
      .from("crm_pending_matches")
      .update({ status: "kept_separate", resolved_by_staff_id: staff.id, resolved_at: now })
      .eq("organization_id", staff.organizationId)
      .eq("status", "open")
      .or(`submitted_contact_id.eq.${id},candidate_contact_id.eq.${id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/contacts delete POST", error);
    return jsonError("Couldn't delete the guest.", 500);
  }
}
