import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { sha256 } from "@/lib/crm/kiosk-auth";
import { cleanText } from "@/lib/crm/normalize";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { leadFormUrl, newLeadFormToken, validateLeadFormSettings } from "@/lib/crm/web-leads";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Admin adds a website form and gets its webhook URL. Only the token's hash
// is stored; the full URL is returned once, here.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const name = cleanText(body?.name, 80);
    if (!name) return jsonError("Give the form a name, like Website contact form.", 400);

    const admin = createSupabaseAdminClient();
    const settings = await validateLeadFormSettings(admin, staff.organizationId, body);
    if ("error" in settings) return jsonError(settings.error, 400);

    const token = newLeadFormToken();
    const { data, error } = await admin
      .from("crm_lead_forms")
      .insert({
        organization_id: staff.organizationId,
        name,
        token_hash: sha256(token),
        how_heard_label: settings.howHeardLabel,
        assigned_staff_id: settings.assignedStaffId,
        created_by_staff_id: staff.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, id: data.id, url: leadFormUrl(resolveRequestOrigin(request), token) });
  } catch (error) {
    logCrmError("crm/lead-forms POST", error);
    return jsonError("Couldn't add the form.", 500);
  }
}
