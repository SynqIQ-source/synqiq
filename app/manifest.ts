import type { MetadataRoute } from "next";
import { getCurrentStaff } from "@/lib/current-staff";
import { getOrgBranding } from "@/lib/org-branding";

const DEFAULT_THEME_COLOR = "#0f766e";
const DEFAULT_ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

// Dynamic, not a static public/manifest.json -- this app is multi-tenant
// (per-org branding already exists: name/primary_color/logo_url), so the
// installed app's name/theme_color/icon need to reflect whichever org the
// requesting session belongs to, same reasoning as the per-request body
// colors in app/layout.tsx. Org logo_url is a single arbitrary-size upload,
// not a proper icon set -- used as-is for now (browsers scale it); real
// multi-size/maskable generation from the uploaded logo is a deliberate
// fast-follow, not built here.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const currentStaff = await getCurrentStaff();
  const branding = currentStaff ? await getOrgBranding(currentStaff.organizationId) : null;

  const name = branding?.name?.trim() || "Synq";
  const shortName = name.length > 12 ? "Synq" : name;

  const icons = branding?.logo_url
    ? [
        { src: branding.logo_url, sizes: "192x192", type: "image/png" },
        { src: branding.logo_url, sizes: "512x512", type: "image/png" },
      ]
    : DEFAULT_ICONS;

  return {
    name,
    short_name: shortName,
    description: "Studio operations dashboard for classes, instructors, and substitutions.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: branding?.primary_color ?? DEFAULT_THEME_COLOR,
    icons,
  };
}
