import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { ACTIVATION_CODE_TTL_MINUTES, newActivationCode, sha256 } from "@/lib/crm/kiosk-auth";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// action "revoke": the device's token stops working immediately, for good
//   (add a new device to pair that iPad again).
// action "new_code": a fresh activation code to re-pair the device (e.g.
//   after Safari's website data was cleared). The old token stops working.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Any admin or salesperson can set who's on duty; everything else is
    // admin-only.
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Device not found.", 404);
    const body = await readJsonBody(request);
    const action = body?.action;
    if (action !== "on_duty" && staff.role !== "admin") return jsonError("Not found.", 404);

    const admin = createSupabaseAdminClient();
    const { data: device, error } = await admin
      .from("kiosk_devices")
      .select("id, revoked_at")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!device) return jsonError("Device not found.", 404);

    // action "on_duty": the salesperson working the front desk on this iPad
    // (null to clear). Returning guests who check in there are reassigned
    // to them.
    if (action === "on_duty") {
      if (device.revoked_at) return jsonError("This device was revoked.", 409);
      let onDuty: string | null = null;
      if (body?.staffId) {
        if (!isUuid(body.staffId)) return jsonError("Pick someone from the list.", 400);
        const { data: member } = await admin
          .from("staff")
          .select("id")
          .eq("id", body.staffId)
          .eq("organization_id", staff.organizationId)
          .is("archived_at", null)
          .maybeSingle();
        if (!member) return jsonError("Pick someone from the list.", 400);
        onDuty = member.id;
      }
      const { error: updateError } = await admin
        .from("kiosk_devices")
        .update({ on_duty_staff_id: onDuty, on_duty_set_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", staff.organizationId);
      if (updateError) throw updateError;
      return NextResponse.json({ success: true });
    }

    if (action === "revoke") {
      const { error: updateError } = await admin
        .from("kiosk_devices")
        .update({
          revoked_at: new Date().toISOString(),
          token_hash: null,
          activation_code_hash: null,
          activation_expires_at: null,
        })
        .eq("id", id)
        .eq("organization_id", staff.organizationId);
      if (updateError) throw updateError;
      return NextResponse.json({ success: true });
    }

    if (action === "new_code") {
      if (device.revoked_at) return jsonError("This device was revoked. Add a new device instead.", 409);
      const code = newActivationCode();
      const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_MINUTES * 60_000).toISOString();
      const { error: updateError } = await admin
        .from("kiosk_devices")
        .update({
          activation_code_hash: sha256(code),
          activation_expires_at: expiresAt,
          token_hash: null,
          activated_at: null,
        })
        .eq("id", id)
        .eq("organization_id", staff.organizationId);
      if (updateError) throw updateError;
      return NextResponse.json({ success: true, activationCode: code, expiresAt });
    }

    return jsonError("Unknown action.", 400);
  } catch (error) {
    logCrmError("crm/kiosk-devices PATCH", error);
    return jsonError("Couldn't update the device.", 500);
  }
}
