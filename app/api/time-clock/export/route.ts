import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadTimesheet, resolveRange } from "@/lib/time-clock/timesheet";
import { punchesCsv, shiftMinutes } from "@/lib/time-clock/hours";

// Payroll export: one CSV line per shift for the range (Club Admins).
export async function GET(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const { data: org } = await createSupabaseAdminClient()
    .from("organizations")
    .select("timezone")
    .eq("id", currentStaff.organizationId)
    .maybeSingle();
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const { from, to } = resolveRange(
    { from: request.nextUrl.searchParams.get("from") ?? undefined, to: request.nextUrl.searchParams.get("to") ?? undefined },
    timezone,
  );
  const { punches } = await loadTimesheet(currentStaff.organizationId, from, to);
  const now = new Date();
  const local = (iso: string) => DateTime.fromISO(iso).setZone(timezone);
  const csv = punchesCsv(
    [...punches]
      .sort((a, b) => a.name.localeCompare(b.name) || a.clockIn.localeCompare(b.clockIn))
      .map((punch) => ({
        name: punch.name,
        date: local(punch.clockIn).toISODate()!,
        clockIn: local(punch.clockIn).toFormat("h:mm a"),
        clockOut: punch.clockOut ? local(punch.clockOut).toFormat("h:mm a") : "Still clocked in",
        minutes: shiftMinutes(punch.clockIn, punch.clockOut, now),
      })),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timesheet-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
