import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getCurrentStaff } from "@/lib/current-staff";
import { brandStyleVars, getOrgBranding } from "@/lib/org-branding";
import { FONT_VARIABLE_CLASS_NAMES } from "@/lib/fonts";

const DEFAULT_THEME_COLOR = "#0f766e";

const SITE_DESCRIPTION =
  "Staff scheduling and substitute coverage for fitness studios.";

export const metadata: Metadata = {
  // synqiq.co (apex) is the canonical host -- www 308s to it at the Vercel
  // domain level. Resolves the relative canonical/OG URLs set per page.
  metadataBase: new URL("https://synqiq.co"),
  title: "SynqIQ",
  description: SITE_DESCRIPTION,
  applicationName: "SynqIQ",
  openGraph: {
    type: "website",
    siteName: "SynqIQ",
    title: "SynqIQ",
    description: SITE_DESCRIPTION,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "SynqIQ" }],
  },
  twitter: {
    card: "summary",
    title: "SynqIQ",
    description: SITE_DESCRIPTION,
    images: ["/icons/icon-512.png"],
  },
  manifest: "/manifest.webmanifest",
  // iOS ignores the manifest's icons list for home-screen install -- needs
  // its own apple-touch-icon link. appleWebApp enables the fuller
  // standalone-like chrome (no Safari UI) when actually added to the home
  // screen; iOS also requires that install step before Web Push works at
  // all (Safari-tab push is not supported on iOS).
  icons: {
    // Manually configuring `icons` at all (needed for `apple` below)
    // stops Next.js from auto-injecting the app/icon.png file-convention
    // favicon -- has to be listed explicitly here too, or the browser tab
    // falls back to the generic globe.
    icon: "/icon.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SynqIQ",
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

  const bodyStyle = branding ? brandStyleVars(branding) : {};

  return (
    <html lang="en">
      <body className={FONT_VARIABLE_CLASS_NAMES} style={bodyStyle as React.CSSProperties}>
        <TooltipProvider>{children}</TooltipProvider>
        {/* Vercel Web Analytics: cookieless, aggregate page views for every
            page (public site + dashboard). Disclosed on /privacy. */}
        <Analytics />
      </body>
    </html>
  );
}
