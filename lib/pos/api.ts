import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckout } from "@/lib/permissions";

export async function requireCheckoutApi() {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckout(currentStaff)) {
    return { error: NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 }) } as const;
  }
  return { currentStaff } as const;
}
