import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { sha256 } from "@/lib/crm/kiosk-auth";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { leadFormUrl, newLeadFormToken, validateLeadFormSettings } from "@/lib/crm/web-leads";
import { resolveRequestOrigin } from "@/lib/request-origin";

type RouteParams = { params: Promise<{ id: string }> };

// Admin only.
// action "settings": change the "how did you hear" label / owner for new leads.
// action "new_url":  a fresh URL; the old one stops working immediately.
// action "revoke":   the URL stops working for good.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Form not found.", 404);
    const body = await readJsonBody(request);
    const admin = createSupabaseAdminClient();

    const { data: form, error } = await admin
      .from("crm_lead_forms")
      .select("id, revoked_at")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!form) return jsonError("Form not found.", 404);
    if (form.revoked_at) return jsonError("This form was turned off. Add a new one instead.", 409);

    const update = async (values: Record<string, unknown>) => {
      const { error: updateError } = await admin
        .from("crm_lead_forms")
        .update(values)
        .eq("id", id)
        .eq("organization_id", staff.organizationId);
      if (updateError) throw updateError;
    };

    if (body?.action === "settings") {
      const settings = await validateLeadFormSettings(admin, staff.organizationId, body);
      if ("error" in settings) return jsonError(settings.error, 400);
      await update({ how_heard_label: settings.howHeardLabel, assigned_staff_id: settings.assignedStaffId });
      return NextResponse.json({ success: true });
    }

    if (body?.action === "new_url") {
      const token = newLeadFormToken();
      await update({ token_hash: sha256(token) });
      return NextResponse.json({ success: true, url: leadFormUrl(resolveRequestOrigin(request), token) });
    }

    if (body?.action === "revoke") {
      await update({ revoked_at: new Date().toISOString(), token_hash: null });
      return NextResponse.json({ success: true });
    }

    return jsonError("Unknown action.", 400);
  } catch (error) {
    logCrmError("crm/lead-forms PATCH", error);
    return jsonError("Couldn't update the form.", 500);
  }
}
