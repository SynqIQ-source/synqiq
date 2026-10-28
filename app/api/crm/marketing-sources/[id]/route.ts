import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Shows or hides an option on the kiosk. Options are never deleted, so past
// guests' answers keep their label.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    const body = await readJsonBody(request);
    if (!isUuid(id) || typeof body?.active !== "boolean") return jsonError("Invalid request.", 400);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crm_marketing_sources")
      .update({ active: body.active })
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .select("id");
    if (error) throw error;
    if (!data?.length) return jsonError("Option not found.", 404);

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/marketing-sources PATCH", error);
    return jsonError("Couldn't update the option.", 500);
  }
}
