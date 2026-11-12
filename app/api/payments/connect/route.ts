import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, requireClubAdminApi } from "@/lib/payroll/api";
import { getOptionalEnv } from "@/lib/env";
import { resolveRequestOrigin } from "@/lib/request-origin";
import {
  connectCreationAllowed,
  createStudioAccount,
  getStudioStripeAccount,
  onboardingLink,
  refreshStudioAccount,
} from "@/lib/payments/connect";

// Club Admin: connect the studio's own Stripe account (or resume onboarding),
// and re-check whether it can take payments. { action: "onboard" | "refresh" }
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const admin = createSupabaseAdminClient();
  const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
  try {
    if (body?.action === "refresh") {
      const account = await refreshStudioAccount(admin, currentStaff.organizationId);
      return NextResponse.json({ success: true, account });
    }
    if (body?.action === "onboard") {
      const existing = await getStudioStripeAccount(admin, currentStaff.organizationId);
      if (!existing && !connectCreationAllowed(getOptionalEnv("STRIPE_SECRET_KEY") ?? undefined)) {
        return fail("Payments aren't switched on for studios yet. SynqIQ turns this on once Stripe confirms the setup.");
      }
      const { data: org } = await admin.from("organizations").select("name").eq("id", currentStaff.organizationId).maybeSingle();
      const accountId =
        existing?.stripeAccountId ??
        (await createStudioAccount(admin, {
          organizationId: currentStaff.organizationId,
          studioName: (org?.name as string | null) ?? "Studio",
          contactEmail: null,
          staffId: currentStaff.id,
        }));
      return NextResponse.json({ success: true, url: await onboardingLink(accountId, origin) });
    }
    return fail("Unknown action.");
  } catch (error) {
    console.error("[payments/connect]", error);
    const message = error instanceof Error ? error.message : "";
    if (/Connect enabled/i.test(message)) return fail("SynqIQ's Stripe platform isn't set up for Connect yet.", 503);
    return fail("Stripe didn't respond. Try again.", 502);
  }
}
