import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentStaff } from "@/lib/current-staff";
import { getOrgBranding } from "@/lib/org-branding";
import { FONT_VARIABLE_CLASS_NAMES, FONT_CSS_VAR_BY_NAME, isAllowedFont } from "@/lib/fonts";

const DEFAULT_THEME_COLOR = "#0f766e";

export const metadata: Metadata = {
  title: "Synq",
  description: "Studio operations dashboard for classes, instructors, and substitutions.",
  manifest: "/manifest.webmanifest",
  // iOS ignores the manifest's icons list for home-screen install -- needs
  // its own apple-touch-icon link. appleWebApp enables the fuller
  // standalone-like chrome (no Safari UI) when actually added to the home
  // screen; iOS also requires that install step before Web Push works at
  // all (Safari-tab push is not supported on iOS).
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Synq",
  },
};

// themeColor lives under viewport, not metadata, as of Next 14+ -- kept
// dynamic (not a static export) so an org's custom primary_color actually
// shows up in the installed PWA's title bar/status bar, same reasoning as
// the body-style branding below.
export async function generateViewport(): Promise<Viewport> {
  const currentStaff = await getCurrentStaff();
  const branding = currentStaff ? await getOrgBranding(currentStaff.organizationId) : null;

  return {
    themeColor: branding?.primary_color ?? DEFAULT_THEME_COLOR,
  };
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
    bodyStyle["--color-accent-hover"] =
      `color-mix(in srgb, ${branding.accent_color} 85%, black)`;
    bodyStyle["--color-accent-subtle"] =
      `color-mix(in srgb, ${branding.accent_color} 12%, white)`;
    bodyStyle["--color-secondary"] = branding.secondary_color;
    bodyStyle["--color-secondary-hover"] =
      `color-mix(in srgb, ${branding.secondary_color} 85%, black)`;
    bodyStyle["--color-secondary-subtle"] =
      `color-mix(in srgb, ${branding.secondary_color} 12%, white)`;
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
