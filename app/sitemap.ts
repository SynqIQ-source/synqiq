import type { MetadataRoute } from "next";

const SITE_URL = "https://synqiq.co";

// Public pages only -- everything under /dashboard requires a session.
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/about", "/contact", "/login", "/privacy", "/terms"].map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
