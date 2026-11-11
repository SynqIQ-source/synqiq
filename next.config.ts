import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 15.2+ streams <title>/<meta> into the <body> for any user agent
  // that isn't on its known-bot list -- the root layout is dynamic, so
  // metadata was landing after </head>. Security scanners (VirusTotal
  // vendors etc.) aren't on that list and saw a head with no title or
  // description. Matching every UA puts metadata back in <head> for
  // everyone; all metadata here is static, so there's no real TTFB cost.
  htmlLimitedBots: /.*/,

  // Framing: only the public widgets (/widget/...) can be embedded on other
  // sites (a studio's website). Everything else -- the dashboard included --
  // can only be framed by SynqIQ itself (clickjacking protection).
  async headers() {
    return [
      {
        source: "/((?!widget/).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      {
        source: "/widget/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          // Short CDN cache: spots left stay close to live without a database
          // hit on every website visit.
          { key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=120" },
        ],
      },
    ];
  },
};

export default nextConfig;
