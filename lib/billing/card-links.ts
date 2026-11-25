import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Emailed "update your card" links (lib/billing/cards.ts). The token is only
// in the email; SynqIQ stores its hash. Valid for 7 days, used once.

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export const LINK_DAYS = 7;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// A one-time link (7 days) a member opens to update their card.
export async function createCardLink(
  admin: Admin,
  organizationId: string,
  clientId: string,
  reason: "staff" | "declined" | "expiring",
  staffId: string | null,
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await admin.from("card_update_links").insert({
    organization_id: organizationId,
    mindbody_client_id: clientId,
    token_hash: hashToken(token),
    reason,
    // Declined / expiring links are about the dues card; staff links let the
    // member pick either card.
    purpose: reason === "staff" ? "either" : "dues",
    created_by_staff_id: staffId,
    expires_at: new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString(),
  });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://synqiq.co";
  return `${site}/card/${token}`;
}

export async function findCardLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("card_update_links")
    .select("id, organization_id, mindbody_client_id, expires_at, used_at, purpose, reason")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.reason === "confirm" || data.used_at || Date.parse(data.expires_at as string) < Date.now()) return null;
  return {
    id: data.id as string,
    organizationId: data.organization_id as string,
    clientId: data.mindbody_client_id as string,
    purpose: (data.purpose as "dues" | "retail" | "either") ?? "dues",
  };
}

// Confirm-payment links (lib/billing/confirm-payment.ts): a renewal the
// member's bank wants them to approve (3D Secure) is approved on /pay/<token>.
export const NEEDS_APPROVAL_CODES = ["authentication_required"] as const;
export const needsApproval = (lastDecline: unknown) =>
  typeof lastDecline === "string" && (NEEDS_APPROVAL_CODES as readonly string[]).includes(lastDecline);

export async function createConfirmLink(
  admin: Admin,
  input: { organizationId: string; clientId: string; chargeId: string; staffId: string | null },
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const { error } = await admin.from("card_update_links").insert({
    organization_id: input.organizationId,
    mindbody_client_id: input.clientId,
    token_hash: hashToken(token),
    reason: "confirm",
    purpose: "dues",
    charge_id: input.chargeId,
    created_by_staff_id: input.staffId,
    expires_at: new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://synqiq.co";
  return `${site}/pay/${token}`;
}
