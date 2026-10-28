import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCrmEnabled } from "@/lib/crm/module";

// Kiosk devices never hold a staff login. An admin creates a device and gets
// a one-time activation code; the iPad exchanges it for a long-lived random
// token kept in an httpOnly cookie. Only SHA-256 hashes are stored, and the
// organization is ALWAYS resolved from the token -- never from the request.

export const KIOSK_COOKIE = "synq_kiosk";
const ACTIVATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const ACTIVATION_CODE_TTL_MINUTES = 15;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newActivationCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += ACTIVATION_ALPHABET[randomInt(ACTIVATION_ALPHABET.length)];
  }
  return code;
}

export function normalizeActivationCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === 8 ? code : null;
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export type KioskDevice = { deviceId: string; organizationId: string; name: string };

// The paired, non-revoked device for this request, in an org that still has
// the CRM module; null otherwise.
export async function getKioskDevice(): Promise<KioskDevice | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 100) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data: device } = await admin
    .from("kiosk_devices")
    .select("id, organization_id, name, revoked_at, activated_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();

  if (!device || device.revoked_at || !device.activated_at) {
    return null;
  }
  if (!(await isCrmEnabled(device.organization_id))) {
    return null;
  }

  // Best-effort heartbeat for the admin device list.
  void admin.from("kiosk_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  return { deviceId: device.id, organizationId: device.organization_id, name: device.name };
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || null;
}
