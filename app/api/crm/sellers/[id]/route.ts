import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Admin toggles staff.can_sell: sellers appear in the kiosk's "Who are you
// meeting?" list and can see the Guests pages.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    const body = await readJsonBody(request);
    if (!isUuid(id) || typeof body?.canSell !== "boolean") return jsonError("Invalid request.", 400);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("staff")
      .update({ can_sell: body.canSell })
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .select("id");
    if (error) throw error;
    if (!data?.length) return jsonError("Staff member not found.", 404);

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/sellers PATCH", error);
    return jsonError("Couldn't update the staff member.", 500);
  }
}
