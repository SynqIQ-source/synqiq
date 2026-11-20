import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { findStudio } from "@/lib/member/session";
import { iconPath, safeColor, shortStudioName } from "@/lib/member/app-icon";

// Every member app page is branded as the studio, not SynqIQ: added to a
// phone's home screen it shows the studio's icon and name, and its color in
// the status bar.
type Props = { params: Promise<{ studio: string }> };

async function studioFor(params: Props["params"]) {
  const { studio } = await params;
  return /^\d{1,9}$/.test(studio) ? findStudio(Number(studio)) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const studio = await studioFor(params);
  if (!studio) return {};
  return {
    applicationName: studio.name,
    manifest: `/m/${studio.siteId}/manifest.webmanifest`,
    icons: {
      icon: iconPath(studio.siteId, 192),
      apple: iconPath(studio.siteId, 180),
    },
    appleWebApp: { capable: true, statusBarStyle: "default", title: shortStudioName(studio.name) },
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const studio = await studioFor(params);
  return { themeColor: safeColor(studio?.primaryColor) };
}

export default function MemberAppLayout({ children }: { children: ReactNode }) {
  return children;
}
