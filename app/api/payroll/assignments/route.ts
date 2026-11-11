import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";

const SCOPES = ["class_schedule", "class_type", "session_type"] as const;

// Pay someone a different rate for one class schedule, class type or session
// type (Club Admin). Body: { staffId, scope, mindbodyId, label, payRateId }
// or { id, remove: true }.
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();

  if (body.remove === true) {
    if (!isUuid(body.id)) return fail("Pick an exception.");
    const { error } = await admin
      .from("staff_pay_assignments")
      .delete()
      .eq("id", body.id)
      .eq("organization_id", currentStaff.organizationId);
    if (error) return fail("Couldn't save. Try again.", 500);
    return NextResponse.json({ success: true });
  }

  const scope = String(body.scope ?? "") as (typeof SCOPES)[number];
  const mindbodyId = Number(body.mindbodyId);
  if (!isUuid(body.staffId)) return fail("Pick a person.");
  if (!SCOPES.includes(scope)) return fail("Pick what the rate is for.");
  if (!Number.isInteger(mindbodyId) || mindbodyId <= 0) return fail("Pick a class or session.");
  if (!isUuid(body.payRateId)) return fail("Pick a rate.");
  const [{ data: person }, { data: rate }] = await Promise.all([
    admin.from("staff").select("id").eq("id", body.staffId).eq("organization_id", currentStaff.organizationId).maybeSingle(),
    admin
      .from("pay_rates")
      .select("id, applies_to")
      .eq("id", body.payRateId)
      .eq("organization_id", currentStaff.organizationId)
      .is("archived_at", null)
      .maybeSingle(),
  ]);
  if (!person) return fail("Person not found.", 404);
  if (!rate) return fail("Rate not found.", 404);
  const wants = scope === "session_type" ? "appointment" : "class";
  if (rate.applies_to !== wants) return fail(wants === "class" ? "Pick a class rate." : "Pick a session rate.");

  const { error } = await admin.from("staff_pay_assignments").upsert(
    {
      organization_id: currentStaff.organizationId,
      staff_id: body.staffId,
      scope,
      mindbody_id: mindbodyId,
      label: typeof body.label === "string" ? body.label.slice(0, 200) : null,
      pay_rate_id: body.payRateId,
      updated_at: new Date().toISOString(),
      updated_by_staff_id: currentStaff.id,
    },
    { onConflict: "staff_id,scope,mindbody_id" },
  );
  if (error) {
    console.error("[payroll] assignment save failed:", error.message);
    return fail("Couldn't save. Try again.", 500);
  }
  return NextResponse.json({ success: true });
}
