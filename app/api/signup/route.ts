import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { startSignup } from "@/lib/billing/signup";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { rateLimit } from "@/lib/crm/rate-limit";
import { getOptionalEnv } from "@/lib/env";
import { parseNewStudio, StudioError } from "@/lib/platform/studios";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Public: starts a self-serve signup and returns the Stripe Checkout page
// to pay on. The studio is created after payment (lib/billing/signup.ts).
export async function POST(request: NextRequest) {
  try {
    // 10 signups an hour per address (hashed: no personal data in the key).
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipKey = createHash("sha256").update(ip).digest("hex").slice(0, 32);
    if (!(await rateLimit(`signup:${ipKey}`, 3600, 10))) {
      return jsonError("Too many attempts. Try again in a little while.", 429);
    }
    const body = await readJsonBody(request);
    if (body?.acceptTerms !== true) return jsonError("Please agree to the Terms of Service and Privacy Policy.", 400);
    const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
    try {
      const { checkoutUrl } = await startSignup(parseNewStudio(body), { origin });
      return NextResponse.json({ success: true, checkoutUrl });
    } catch (error) {
      if (error instanceof StudioError) return jsonError(error.message, 400);
      throw error;
    }
  } catch (error) {
    logCrmError("signup POST", error);
    return jsonError("Couldn't start the signup. Please try again or email us.", 500);
  }
}
