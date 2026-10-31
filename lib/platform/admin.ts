import { cache } from "react";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Platform admins run SynqIQ itself (add studios, connect their Mindbody
// sites), as opposed to a studio's own admins. Listed in platform_admins by
// auth user; only the service role can read that table.
export type PlatformAdmin = { authUserId: string; email: string | null };

export const getPlatformAdmin = cache(async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await createSupabaseAdminClient()
    .from("platform_admins")
    .select("auth_user_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data ? { authUserId: user.id, email: user.email ?? null } : null;
});

// Pages: anyone else gets a 404, so the area isn't advertised.
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  return admin;
}
