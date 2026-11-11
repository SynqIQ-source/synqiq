import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents, fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";

// Set one person's hourly rate and default class / session rates (Club Admin).
// Body: { staffId, hourly (dollars or blank), classRateId (uuid | null), appointmentRateId (uuid | null) }
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isUuid(body.staffId)) return fail("Pick a person.");
  const hourly = dollarsToCents(body.hourly);
  if (Number.isNaN(hourly) || (hourly != null && (hourly < 0 || hourly > 100_000)))
    return fail("Enter an hourly rate between $0 and $1,000.");
  const classRateId = isUuid(body.classRateId) ? body.classRateId : null;
  const appointmentRateId = isUuid(body.appointmentRateId) ? body.appointmentRateId : null;

  const admin = createSupabaseAdminClient();
  const [{ data: person }, { data: rates }] = await Promise.all([
    admin.from("staff").select("id").eq("id", body.staffId).eq("organization_id", currentStaff.organizationId).maybeSingle(),
    admin
      .from("pay_rates")
      .select("id, applies_to")
      .eq("organization_id", currentStaff.organizationId)
      .is("archived_at", null)
      .in(
        "id",
        [classRateId, appointmentRateId].filter((value): value is string => Boolean(value)),
      ),
  ]);
  if (!person) return fail("Person not found.", 404);
  const kindOf = new Map((rates ?? []).map((rate) => [rate.id as string, rate.applies_to as string]));
  if (classRateId && kindOf.get(classRateId) !== "class") return fail("Pick a class rate.");
  if (appointmentRateId && kindOf.get(appointmentRateId) !== "appointment") return fail("Pick a session rate.");

  const { error } = await admin.from("staff_pay_settings").upsert({
    staff_id: body.staffId,
    organization_id: currentStaff.organizationId,
    hourly_rate_cents: hourly,
    class_rate_id: classRateId,
    appointment_rate_id: appointmentRateId,
    updated_at: new Date().toISOString(),
    updated_by_staff_id: currentStaff.id,
  });
  if (error) {
    console.error("[payroll] staff pay save failed:", error.message);
    return fail("Couldn't save. Try again.", 500);
  }
  return NextResponse.json({ success: true });
}
