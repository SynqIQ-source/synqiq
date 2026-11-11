import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";

// Shared bits for the payroll settings API routes (Club Admin only).

export async function requireClubAdminApi() {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return { error: NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 }) } as const;
  }
  return { currentStaff } as const;
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// "$12.50" / "12.5" / 12.5 -> 1250 cents. Blank -> null. Bad -> NaN.
export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : NaN;
}

export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
