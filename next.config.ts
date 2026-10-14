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
};

export default nextConfig;
