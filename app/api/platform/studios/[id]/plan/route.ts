import { NextRequest, NextResponse } from "next/server";
import { updateSubscriptionPlan } from "@/lib/billing/subscriptions";
import { getPlatformAdmin } from "@/lib/platform/admin";
import { isModuleKey, MODULES } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// A studio's plan (platform admins only): which modules are on, and an
// optional custom monthly price (null = the list price for those modules).
// Turning a module off hides its pages for that studio; its data is kept.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    if (!(await getPlatformAdmin())) return jsonError("Not found.", 404);
    const { id } = await params;
    if (!isUuid(id)) return jsonError("Studio not found.", 404);
    const body = await readJsonBody(request);
    const modules = body?.modules;
    if (!Array.isArray(modules) || !modules.every(isModuleKey)) return jsonError("Pick modules from the list.", 400);
    let customPrice: number | null = null;
    if (body?.customPrice !== null && body?.customPrice !== undefined && body?.customPrice !== "") {
      customPrice = Number(body.customPrice);
      if (!Number.isFinite(customPrice) || customPrice < 0 || customPrice > 100000) {
        return jsonError("The custom price should be a dollar amount.", 400);
      }
    }

    const admin = createSupabaseAdminClient();
    const { data: org } = await admin.from("organizations").select("id").eq("id", id).maybeSingle();
    if (!org) return jsonError("Studio not found.", 404);

    const { error: moduleError } = await admin.from("org_modules").upsert(
      MODULES.map((module) => ({
        organization_id: id,
        module: module.key,
        status: modules.includes(module.key) ? "enabled" : "disabled",
      })),
      { onConflict: "organization_id,module" },
    );
    if (moduleError) throw moduleError;
    const { error: priceError } = await admin
      .from("organizations")
      .update({ custom_monthly_price: customPrice })
      .eq("id", id);
    if (priceError) throw priceError;
    // A self-serve studio's Stripe subscription follows its modules.
    let billing: string = "not billed in Stripe";
    try {
      billing = (await updateSubscriptionPlan(id, modules)) === "updated" ? "subscription updated" : "no change";
    } catch (error) {
      logCrmError("platform/studios plan: Stripe update", error);
      return jsonError("Modules saved, but the Stripe subscription couldn't be updated. Check it in Stripe.", 502);
    }
    return NextResponse.json({ success: true, billing });
  } catch (error) {
    logCrmError("platform/studios plan PATCH", error);
    return jsonError("Couldn't save the plan.", 500);
  }
}
