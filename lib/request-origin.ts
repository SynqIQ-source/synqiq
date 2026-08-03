import type { NextRequest } from "next/server";

// request.url / request.nextUrl.origin reflect Next's dev server's own
// bind address (confirmed empirically: literally "localhost:3000", even
// over HTTPS through a tunnel) -- they are NOT derived from the incoming
// Host/X-Forwarded-Host headers, which is the actual public-facing origin
// a reverse proxy or tunnel (ngrok, and eventually a real production load
// balancer) sees. Any redirect built from request.url silently sends the
// visitor back to localhost instead of wherever they actually are.
// X-Forwarded-Host/-Proto are the standard headers a proxy sets for
// exactly this; falling back to request.nextUrl.origin covers direct,
// unproxied access (plain local dev).
export function resolveRequestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) {
    return request.nextUrl.origin;
  }
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${forwardedProto}://${forwardedHost}`;
}
