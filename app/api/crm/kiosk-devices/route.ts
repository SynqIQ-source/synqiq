import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { ACTIVATION_CODE_TTL_MINUTES, newActivationCode, sha256 } from "@/lib/crm/kiosk-auth";
import { cleanText } from "@/lib/crm/normalize";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

// Admin creates a kiosk device and gets a one-time activation code to type
// into the iPad at /kiosk. Only the code's hash is stored; the plain code is
// returned once, here.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const name = cleanText(body?.name, 80);
    if (!name) return jsonError("Give the device a name, like Front desk iPad.", 400);

    const code = newActivationCode();
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_MINUTES * 60_000).toISOString();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kiosk_devices")
      .insert({
        organization_id: staff.organizationId,
        name,
        activation_code_hash: sha256(code),
        activation_expires_at: expiresAt,
        created_by_staff_id: staff.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, id: data.id, activationCode: code, expiresAt });
  } catch (error) {
    logCrmError("crm/kiosk-devices POST", error);
    return jsonError("Couldn't create the device.", 500);
  }
}
