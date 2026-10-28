import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FONT_CSS_VAR_BY_NAME, isAllowedFont } from "@/lib/fonts";

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

// CSS custom properties that re-theme everything below the element they're
// set on. The root layout puts them on <body> for a signed-in staff
// member's org; the kiosk puts them on its own wrapper for the device's org.
export function brandStyleVars(branding: OrgBranding): Record<string, string> {
  const bodyStyle: Record<string, string> = {};
  // Raw token variables (not --color-*): globals.css maps them through
  // `@theme inline`, so every utility reads var(--primary) etc. at runtime
  // and these overrides take effect. Hover/subtle shades are literal
  // color-mix() strings with the hex baked in. --ring and --chart-1 are
  // re-set here too: in :root they're var(--primary), but a custom
  // property's var() resolves where it's declared, so a <body>-level
  // --primary override alone wouldn't reach them.
  bodyStyle["--primary"] = branding.primary_color;
  bodyStyle["--primary-hover"] = `color-mix(in srgb, ${branding.primary_color} 85%, black)`;
  bodyStyle["--primary-subtle"] = `color-mix(in srgb, ${branding.primary_color} 12%, white)`;
  bodyStyle["--ring"] = branding.primary_color;
  bodyStyle["--chart-1"] = branding.primary_color;
  bodyStyle["--brand-accent"] = branding.accent_color;
  bodyStyle["--brand-accent-hover"] = `color-mix(in srgb, ${branding.accent_color} 85%, black)`;
  bodyStyle["--brand-accent-subtle"] = `color-mix(in srgb, ${branding.accent_color} 12%, white)`;
  bodyStyle["--brand-secondary"] = branding.secondary_color;
  bodyStyle["--brand-secondary-hover"] = `color-mix(in srgb, ${branding.secondary_color} 85%, black)`;
  bodyStyle["--brand-secondary-subtle"] = `color-mix(in srgb, ${branding.secondary_color} 12%, white)`;
  if (isAllowedFont(branding.font_family)) {
    bodyStyle["--font-body"] = FONT_CSS_VAR_BY_NAME[branding.font_family];
  }
  return bodyStyle;
}
