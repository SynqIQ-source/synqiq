import { NextResponse } from "next/server";

// The guest check-in iPad's own home-screen app. Without this, a shortcut
// saved from /kiosk used the staff app's manifest and opened /dashboard
// (the staff login) instead of the waiver. Scoped to /kiosk so it never
// wanders into the staff app.
export function GET() {
  return NextResponse.json(
    {
      name: "Guest Check-in",
      short_name: "Check-in",
      description: "Guest check-in and waiver.",
      id: "/kiosk",
      start_url: "/kiosk",
      scope: "/kiosk",
      display: "standalone",
      orientation: "any",
      background_color: "#ffffff",
      theme_color: "#0f766e",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
