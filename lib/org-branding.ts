import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type OrgBranding = {
  name: string | null;
  primary_color: string;
  accent_color: string;
  secondary_color: string;
  font_family: string;
  logo_url: string | null;
};

// Admin client, not the RLS-scoped one: a read-only lookup of one row by id
// (the caller's own org, already resolved from a real session), same trust
// level as every other pre-RLS-rollout read in this codebase -- not an
// escalation, and avoids standing up a cookie-bound client just to read a
// handful of columns.
//
// Wrapped in React's cache() because both the root layout (body colors) and
// the manifest route (name/theme_color/icon) now need this same query
// within a single request -- cache() dedupes calls sharing the same
// arguments during one render pass, so it only actually hits the DB once.
export const getOrgBranding = cache(async function getOrgBranding(
  organizationId: string,
): Promise<OrgBranding | null> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("name, primary_color, accent_color, secondary_color, font_family, logo_url")
    .eq("id", organizationId)
    .maybeSingle();

  return data;
});
