import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getContactViewerForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { cleanText } from "@/lib/crm/normalize";

type RouteParams = { params: Promise<{ id: string }> };

// Marks (or un-marks) that a new member declined the intro workout, with an
// optional reason. Allowed for the member's assigned trainer and CRM staff
// (same check as notes). Each change is also saved as a profile note.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return jsonError("Member not found.", 404);
    const viewer = await getContactViewerForApi(id);
    if (!viewer) return jsonError("Not found.", 404);
    const { staff } = viewer;

    const body = await readJsonBody(request);
    if (typeof body?.declined !== "boolean") return jsonError("Invalid request.", 400);
    const reason =
      body.declined && typeof body.reason === "string" && body.reason.trim() ? cleanText(body.reason.trim(), 500) : null;

    const admin = createSupabaseAdminClient();
    const { data: contact, error } = await admin
      .from("crm_contacts")
      .select("id, member_enrolled_at")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!contact) return jsonError("Member not found.", 404);
    if (!contact.member_enrolled_at) return jsonError("Only new members have an intro workout.", 400);

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("crm_contacts")
      .update(
        body.declined
          ? { intro_declined_at: now, intro_declined_by_staff_id: staff.id, intro_declined_reason: reason, updated_at: now }
          : { intro_declined_at: null, intro_declined_by_staff_id: null, intro_declined_reason: null, updated_at: now },
      )
      .eq("id", id);
    if (updateError) throw updateError;

    const { error: noteError } = await admin.from("crm_notes").insert({
      organization_id: staff.organizationId,
      contact_id: id,
      author_staff_id: staff.id,
      body: body.declined
        ? `Declined the intro workout${reason ? `: ${reason}` : "."}`
        : "Intro workout decline undone.",
    });
    if (noteError) throw noteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/contacts/intro PATCH", error);
    return jsonError("Couldn't update the intro status.", 500);
  }
}
