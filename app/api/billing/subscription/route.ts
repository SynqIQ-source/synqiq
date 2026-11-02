import { NextRequest, NextResponse } from "next/server";
import { billingPortalUrl, setCancelAtPeriodEnd } from "@/lib/billing/account";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { getCurrentStaff } from "@/lib/current-staff";
import { getOptionalEnv } from "@/lib/env";
import { resolveRequestOrigin } from "@/lib/request-origin";

const FEEDBACK = ["too_expensive", "missing_features", "switched_service", "unused", "other"] as const;

// A studio admin's own billing:
//   { action: "portal" }                       Stripe billing portal link
//   { action: "cancel", feedback?, comment? }  cancel at the end of the paid period
//   { action: "resume" }                       undo a pending cancellation
export async function POST(request: NextRequest) {
  try {
    const staff = await getCurrentStaff();
    if (!staff || staff.role !== "admin") return jsonError("Not found.", 404);
    const body = await readJsonBody(request);
    if (body?.action === "portal") {
      const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
      return NextResponse.json({
        success: true,
        url: await billingPortalUrl(staff.organizationId, `${origin}/dashboard/settings/billing`),
      });
    }
    if (body?.action === "cancel") {
      const feedback = FEEDBACK.find((option) => option === body.feedback);
      const comment = typeof body.comment === "string" ? body.comment.trim() : undefined;
      await setCancelAtPeriodEnd(staff.organizationId, true, { feedback, comment: comment || undefined });
      return NextResponse.json({ success: true });
    }
    if (body?.action === "resume") {
      await setCancelAtPeriodEnd(staff.organizationId, false);
      return NextResponse.json({ success: true });
    }
    return jsonError("Invalid request.", 400);
  } catch (error) {
    logCrmError("billing/subscription POST", error);
    return jsonError("Couldn't reach billing. Please try again or email us.", 500);
  }
}
