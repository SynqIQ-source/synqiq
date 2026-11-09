import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Club admin toggles staff.can_sell: salespeople appear in the kiosk's "Who
// are you meeting?" list, can be assigned leads and are credited with sales.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    const body = await readJsonBody(request);
    if (!isUuid(id) || typeof body?.canSell !== "boolean") return jsonError("Invalid request.", 400);

    const admin = createSupabaseAdminClient();
    const { data: target, error: targetError } = await admin
      .from("staff")
      .select("id, role")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return jsonError("Staff member not found.", 404);

    // Kept in step with roles (lib/permissions.ts): turning selling on for
    // plain Staff makes them Sales, and off for Sales makes them Staff. Club
    // Admins and Sales Leads keep their role either way.
    const role =
      body.canSell && target.role === "staff" ? "sales" : !body.canSell && target.role === "sales" ? "staff" : target.role;
    const { error } = await admin.from("staff").update({ can_sell: body.canSell, role }).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/sellers PATCH", error);
    return jsonError("Couldn't update the staff member.", 500);
  }
}
