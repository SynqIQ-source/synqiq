import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Studio email domains (migration 20261120180000). Until a studio's domain is
// verified in Resend, everything keeps using SynqIQ's: notifications@synqiq.co
// and the FOLLOWUP_RELAY_DOMAIN reply addresses.

export const DEFAULT_FROM_DOMAIN = "synqiq.co";
export const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function cleanDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return domain && domain.length <= 200 && DOMAIN_PATTERN.test(domain) ? domain : null;
}

export type StudioDomains = { from: string | null; relay: string | null };

// The studio's verified domains (null = use SynqIQ's).
export async function studioDomains(admin: Admin, organizationId: string): Promise<StudioDomains> {
  const { data } = await admin
    .from("organizations")
    .select("email_from_domain, email_from_verified_at, email_relay_domain, email_relay_verified_at")
    .eq("id", organizationId)
    .maybeSingle();
  return {
    from: data?.email_from_verified_at ? ((data.email_from_domain as string | null) ?? null) : null,
    relay: data?.email_relay_verified_at ? ((data.email_relay_domain as string | null) ?? null) : null,
  };
}

export const fromAddress = (displayName: string, domain: string | null | undefined) =>
  `${displayName.replace(/[<>"]/g, "")} <notifications@${domain || DEFAULT_FROM_DOMAIN}>`;

// New relay reply addresses for a studio.
export async function relayDomainFor(admin: Admin, organizationId: string): Promise<string> {
  return (await studioDomains(admin, organizationId)).relay ?? getEnv("FOLLOWUP_RELAY_DOMAIN");
}

// Every domain inbound relay mail may arrive on: SynqIQ's plus each studio's
// verified reply domain (old conversations keep working on SynqIQ's).
let cached: { at: number; domains: string[] } | null = null;
export async function inboundRelayDomains(): Promise<string[]> {
  if (cached && Date.now() - cached.at < 60_000) return cached.domains;
  const base = (process.env.FOLLOWUP_RELAY_DOMAIN ?? "").toLowerCase();
  const { data } = await createSupabaseAdminClient()
    .from("organizations")
    .select("email_relay_domain")
    .not("email_relay_domain", "is", null)
    .not("email_relay_verified_at", "is", null);
  const domains = [base, ...(data ?? []).map((row) => String(row.email_relay_domain).toLowerCase())].filter(Boolean);
  cached = { at: Date.now(), domains: [...new Set(domains)] };
  return cached.domains;
}

export const onDomains = (email: string, domains: string[]) => domains.some((domain) => email.toLowerCase().endsWith(`@${domain}`));

export type ResendDomainStatus = { found: boolean; status: string | null; sending: boolean; receiving: boolean } | { error: string };

// What Resend says about a domain (Resend > Domains).
export async function resendDomainStatus(domain: string): Promise<ResendDomainStatus> {
  try {
    const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${getEnv("RESEND_API_KEY")}` } });
    if (!response.ok) return { error: `Resend said ${response.status}.` };
    const json = (await response.json()) as {
      data?: { name: string; status: string; capabilities?: { sending?: string; receiving?: string } }[];
    };
    const row = (json.data ?? []).find((item) => item.name.toLowerCase() === domain);
    if (!row) return { found: false, status: null, sending: false, receiving: false };
    return {
      found: true,
      status: row.status,
      sending: row.capabilities?.sending === "enabled",
      receiving: row.capabilities?.receiving === "enabled",
    };
  } catch {
    return { error: "Couldn't reach Resend." };
  }
}
