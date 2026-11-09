import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

// True when a request carries `Authorization: Bearer <CRON_SECRET>` (Vercel
// cron and manual sync triggers). Compared in constant time, like the
// Twilio/Resend webhook verifiers, so response timing can't leak the secret.
// Hashing first gives equal-length buffers for timingSafeEqual.
export function isCronRequest(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${getEnv("CRON_SECRET")}`;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(expected));
}
