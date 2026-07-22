import type { Metadata } from "next";
import "./globals.css";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FONT_VARIABLE_CLASS_NAMES, FONT_CSS_VAR_BY_NAME, isAllowedFont } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Synq",
  description: "Studio operations dashboard for classes, instructors, and substitutions.",
};

// Admin client, not the RLS-scoped one: this is a read-only lookup of
// exactly one row by id (the caller's own org, already resolved from a real
// session above), same trust level as every other pre-RLS-rollout read in
// this codebase -- not an escalation, and avoids standing up a cookie-bound
// client on every single page render just to read three columns.
async function getOrgBranding(organizationId: string) {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("primary_color, accent_color, font_family")
    .eq("id", organizationId)
    .maybeSingle();

  return data;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // No session (pre-auth pages, or the no-login dropdown-mode staff) means
  // no org to resolve -- bodyStyle stays empty and the @theme defaults in
  // globals.css apply, which render identically to this app's original
  // fixed teal look.
  const currentStaff = await getCurrentStaff();
  const branding = currentStaff ? await getOrgBranding(currentStaff.organizationId) : null;

  const bodyStyle: Record<string, string> = {};
  if (branding) {
    // Literal color-mix() strings with the hex baked in directly, not
    // var(--color-primary) references -- these are plain inline style
    // values, not @theme tokens, so there's no build-time-flattening trap
    // here, but baking the hex in directly keeps it unambiguous either way.
    bodyStyle["--color-primary"] = branding.primary_color;
    bodyStyle["--color-primary-hover"] =
      `color-mix(in srgb, ${branding.primary_color} 85%, black)`;
    bodyStyle["--color-primary-subtle"] =
      `color-mix(in srgb, ${branding.primary_color} 12%, white)`;
    bodyStyle["--color-accent"] = branding.accent_color;
    bodyStyle["--color-accent-subtle"] =
      `color-mix(in srgb, ${branding.accent_color} 12%, white)`;
    if (isAllowedFont(branding.font_family)) {
      bodyStyle["--font-body"] = FONT_CSS_VAR_BY_NAME[branding.font_family];
    }
  }

  return (
    <html lang="en">
      <body className={FONT_VARIABLE_CLASS_NAMES} style={bodyStyle as React.CSSProperties}>
        {children}
      </body>
    </html>
  );
}
