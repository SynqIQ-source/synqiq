import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashToken, newToken } from "@/lib/member/password";

// Member sign-in sessions (separate from staff sign-in). The cookie holds a
// random token; the database holds only its hash. Service role throughout.

export const MEMBER_COOKIE = "synq_member";
const SESSION_DAYS = 30;

export type Studio = {
  id: string;
  name: string;
  siteId: number;
  timezone: string;
  mode: "off" | "testers" | "open";
  logoUrl: string | null;
  primaryColor: string;
};

export type Member = {
  accountId: string;
  sessionId: string;
  organizationId: string;
  mindbodyClientId: string;
  email: string;
  firstName: string;
  name: string;
};

export async function findStudio(siteId: number): Promise<Studio | null> {
  if (!Number.isInteger(siteId) || siteId <= 0) return null;
  const { data } = await createSupabaseAdminClient()
    .from("organizations")
    .select("id, name, mindbody_site_id, timezone, member_portal_mode, logo_url, primary_color")
    .eq("mindbody_site_id", siteId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    siteId,
    timezone: (data.timezone as string | null) ?? "America/Chicago",
    mode: (data.member_portal_mode as Studio["mode"]) ?? "testers",
    logoUrl: (data.logo_url as string | null) ?? null,
    primaryColor: (data.primary_color as string | null) ?? "#0f766e",
  };
}

// Can this client use member booking right now? 'off': nobody; 'testers':
// only clients a Club Admin added; 'open': everyone.
export async function memberPortalAllowed(studio: Pick<Studio, "id" | "mode">, mindbodyClientId: string): Promise<boolean> {
  if (studio.mode === "open") return true;
  if (studio.mode === "off") return false;
  const { data } = await createSupabaseAdminClient()
    .from("member_portal_testers")
    .select("mindbody_client_id")
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", mindbodyClientId)
    .maybeSingle();
  return Boolean(data);
}

// The signed-in member for this studio, or null.
export async function getCurrentMember(studio: Studio): Promise<Member | null> {
  const token = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("member_sessions")
    .select("id, expires_at, account:member_accounts!inner ( id, organization_id, mindbody_client_id, email )")
    .eq("token_hash", hashToken(token))
    .maybeSingle<{
      id: string;
      expires_at: string;
      account: { id: string; organization_id: string; mindbody_client_id: string; email: string };
    }>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
  if (session.account.organization_id !== studio.id) return null;
  if (!(await memberPortalAllowed(studio, session.account.mindbody_client_id))) return null;
  const { data: client } = await admin
    .from("clients")
    .select("first_name, last_name")
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", session.account.mindbody_client_id)
    .maybeSingle();
  const firstName = ((client?.first_name as string | null) ?? "").trim();
  return {
    accountId: session.account.id,
    sessionId: session.id,
    organizationId: studio.id,
    mindbodyClientId: session.account.mindbody_client_id,
    email: session.account.email,
    firstName: firstName || "there",
    name: `${firstName} ${((client?.last_name as string | null) ?? "").trim()}`.trim() || session.account.email,
  };
}

export async function startSession(accountId: string, request: NextRequest, response: NextResponse): Promise<void> {
  const { token, hash } = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const { error } = await createSupabaseAdminClient()
    .from("member_sessions")
    .insert({
      account_id: accountId,
      token_hash: hash,
      expires_at: expires.toISOString(),
      user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    });
  if (error) throw new Error(`member session: ${error.message}`);
  response.cookies.set(MEMBER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession(request: NextRequest, response: NextResponse): Promise<void> {
  const token = request.cookies.get(MEMBER_COOKIE)?.value;
  if (token) await createSupabaseAdminClient().from("member_sessions").delete().eq("token_hash", hashToken(token));
  response.cookies.set(MEMBER_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Member POSTs must come from our own pages (cookies are SameSite=Lax too).
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
