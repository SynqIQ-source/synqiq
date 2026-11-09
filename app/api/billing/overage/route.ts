import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { chargeTextingOverage } from "@/lib/billing/subscriptions";

// Monthly (cron, the 1st): last month's texts over the allowance go on each
// billed studio's next invoice. Safe to run twice; a month is charged once.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ success: true, charged: await chargeTextingOverage() });
  } catch (error) {
    console.error("[billing/overage]", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
