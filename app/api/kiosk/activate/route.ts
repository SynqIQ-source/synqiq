import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCrmEnabled } from "@/lib/crm/module";
import { KIOSK_COOKIE, clientIp, newDeviceToken, normalizeActivationCode, sha256 } from "@/lib/crm/kiosk-auth";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

// Pairs an iPad: exchanges a one-time activation code (issued by an admin in
// CRM settings, valid 15 minutes) for a device token in an httpOnly cookie.
// The code is single use -- its hash is cleared on success.
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request.headers) ?? "unknown";
    const allowed = await rateLimitAll([
      { key: `kiosk-activate:ip:${sha256(ip)}`, windowSeconds: 900, limit: 10 },
      { key: "kiosk-activate:global", windowSeconds: 900, limit: 100 },
    ]);
    if (!allowed) {
      return jsonError("Too many attempts. Wait a few minutes and try again.", 429);
    }

    const body = await readJsonBody(request);
    const code = normalizeActivationCode(body?.code);
    if (!code) {
      return jsonError("Enter the 8-character code from CRM settings.", 400);
    }

    const admin = createSupabaseAdminClient();
    const { data: device, error } = await admin
      .from("kiosk_devices")
      .select("id, organization_id, activation_expires_at, revoked_at")
      .eq("activation_code_hash", sha256(code))
      .maybeSingle();
    if (error) throw error;

    const expired = !device?.activation_expires_at || new Date(device.activation_expires_at) < new Date();
    if (!device || device.revoked_at || expired || !(await isCrmEnabled(device.organization_id))) {
      return jsonError("That code is invalid or has expired. Ask an admin for a new one.", 400);
    }

    const token = newDeviceToken();
    const { data: paired, error: updateError } = await admin
      .from("kiosk_devices")
      .update({
        token_hash: sha256(token),
        activated_at: new Date().toISOString(),
        activation_code_hash: null,
        activation_expires_at: null,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", device.id)
      // Guards a race between two iPads entering the same code at once.
      .eq("activation_code_hash", sha256(code))
      .select("id");
    if (updateError) throw updateError;
    if (!paired || paired.length !== 1) {
      return jsonError("That code is invalid or has expired. Ask an admin for a new one.", 400);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(KIOSK_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 400, // browsers cap cookie lifetime at 400 days
    });
    return response;
  } catch (error) {
    logCrmError("kiosk/activate", error);
    return jsonError("Something went wrong. Try again.", 500);
  }
}
