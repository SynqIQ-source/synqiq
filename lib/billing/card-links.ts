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
    .select("id, organization_id, mindbody_client_id, expires_at, used_at, purpose")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.used_at || Date.parse(data.expires_at as string) < Date.now()) return null;
  return {
    id: data.id as string,
    organizationId: data.organization_id as string,
    clientId: data.mindbody_client_id as string,
    purpose: (data.purpose as "dues" | "retail" | "either") ?? "dues",
  };
}
