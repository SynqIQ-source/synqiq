import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCheckInStatus } from "@/lib/checkin/status";

// Check someone in. What covers the visit is worked out again here (not
// trusted from the browser); when nothing covers it a reason is required.
// Doesn't touch Mindbody, which still records arrivals until the switch.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { mindbodyClientId?: unknown; note?: unknown } | null;
  const clientId = typeof body?.mindbodyClientId === "string" ? body.mindbodyClientId : "";
  if (!/^[\w-]{1,40}$/.test(clientId)) return NextResponse.json({ success: false, error: "Pick someone to check in." }, { status: 400 });
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";

  const status = await loadCheckInStatus(currentStaff.organizationId, clientId);
  if (!status) return NextResponse.json({ success: false, error: "Unknown person." }, { status: 404 });
  if (!status.decision.covered && !note) {
    return NextResponse.json(
      { success: false, error: "Nothing covers this visit. Add a reason to check them in anyway." },
      { status: 400 },
    );
  }
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle();
  const { data: saved, error } = await admin
    .from("check_ins")
    .insert({
      organization_id: currentStaff.organizationId,
      mindbody_client_id: clientId,
      client_name: status.client.name,
      local_date: DateTime.now()
        .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
        .toISODate(),
      checked_in_by_staff_id: currentStaff.id,
      method: "front_desk",
      coverage_kind: status.decision.kind,
      coverage_name: status.decision.coverageName,
      mindbody_client_service_id: status.decision.serviceId,
      member_contract_id: status.decision.contractId,
      warnings: status.decision.warnings,
      note: note || null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[check-in] save failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't check in. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, id: saved.id, coverage: status.decision.coverageName });
}
