import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireClubAdminApi } from "@/lib/payroll/api";
import { buildPayroll } from "@/lib/payroll/report";
import { payrollCsv } from "@/lib/payroll/export";
import { resolveRange } from "@/lib/time-clock/timesheet";

export const maxDuration = 120;

// Payroll CSV for a pay period, in the Mindbody export's columns (Club Admin).
export async function GET(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const params = request.nextUrl.searchParams;
  const { from, to } = resolveRange({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, zone);
  const batch = (params.get("batch") ?? "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 20);
  const payroll = await buildPayroll(currentStaff.organizationId, from, to, admin);
  return new NextResponse(payrollCsv(payroll.people, payroll.timezone, batch), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll ${from} to ${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
