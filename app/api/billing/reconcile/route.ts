import { NextRequest, NextResponse } from "next/server";
import { reconcileBilling } from "@/lib/billing/subscriptions";
import { getEnv, getOptionalEnv } from "@/lib/env";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Nightly (cron): billing statuses re-read from Stripe and any paid signup
// still missing its studio finished -- the safety net for the webhook.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
    return NextResponse.json({ success: true, ...(await reconcileBilling(`${origin}/auth/confirm`)) });
  } catch (error) {
    console.error("[billing/reconcile]", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
