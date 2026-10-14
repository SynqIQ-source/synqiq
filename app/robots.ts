import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/auth/", "/reset-password"],
    },
    sitemap: "https://synqiq.co/sitemap.xml",
    host: "https://synqiq.co",
  };
}
