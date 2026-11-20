import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { findStudio } from "@/lib/member/session";
import { ICON_SIZES, safeColor, studioInitials, type IconSize } from "@/lib/member/app-icon";

// The studio's home-screen icon, drawn on request: the studio logo on white
// over the studio color, or the studio's initials until a logo is uploaded.
// Maskable icons keep the content inside Android's safe zone.
export async function GET(request: NextRequest, { params }: { params: Promise<{ studio: string; size: string }> }) {
  const { studio: studioParam, size: sizeParam } = await params;
  const size = Number(sizeParam) as IconSize;
  const studio = /^\d{1,9}$/.test(studioParam) ? await findStudio(Number(studioParam)) : null;
  if (!studio || !ICON_SIZES.includes(size)) return new Response("Not found", { status: 404 });
  const maskable = request.nextUrl.searchParams.get("maskable") === "1";
  const color = safeColor(studio.primaryColor);
  const inner = Math.round(size * (maskable ? 0.62 : 0.78));
  const logo = studio.logoUrl && /^https:\/\//.test(studio.logoUrl) ? studio.logoUrl : null;

  return new ImageResponse(
    <div style={{ width: size, height: size, background: color, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {logo ? (
        <div
          style={{
            width: inner,
            height: inner,
            borderRadius: inner * 0.18,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG */}
          <img src={logo} alt="" width={inner * 0.84} height={inner * 0.84} style={{ objectFit: "contain" }} />
        </div>
      ) : (
        <span style={{ color: "#ffffff", fontSize: inner * 0.5, fontWeight: 700, letterSpacing: -1 }}>{studioInitials(studio.name)}</span>
      )}
    </div>,
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
