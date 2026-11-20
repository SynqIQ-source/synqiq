import { NextResponse } from "next/server";
import { findStudio } from "@/lib/member/session";
import { iconPath, logoVersion, safeColor, shortStudioName } from "@/lib/member/app-icon";

// The member app installs as the studio's own app: its name, color and icon,
// opening on the studio's Book screen.
export async function GET(_request: Request, { params }: { params: Promise<{ studio: string }> }) {
  const { studio: studioParam } = await params;
  const studio = /^\d{1,9}$/.test(studioParam) ? await findStudio(Number(studioParam)) : null;
  if (!studio) return new NextResponse("Not found", { status: 404 });
  const color = safeColor(studio.primaryColor);
  return NextResponse.json(
    {
      id: `/m/${studio.siteId}`,
      name: studio.name,
      short_name: shortStudioName(studio.name),
      description: `Book classes and manage your membership at ${studio.name}.`,
      start_url: `/m/${studio.siteId}`,
      scope: `/m/${studio.siteId}`,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: color,
      icons: [
        { src: iconPath(studio.siteId, 192, false, logoVersion(studio.logoUrl)), sizes: "192x192", type: "image/png" },
        { src: iconPath(studio.siteId, 512, false, logoVersion(studio.logoUrl)), sizes: "512x512", type: "image/png" },
        { src: iconPath(studio.siteId, 512, true, logoVersion(studio.logoUrl)), sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
