import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

const STATUSES = ["scheduled", "showed", "no_show", "canceled"] as const;

// Sets an appointment's outcome (admins and sellers). Marking it Showed also
// records an Appointment visit, unless the guest already checked in at the
// kiosk for it, so it counts on the Guests list and the Sales dashboard.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    const body = await readJsonBody(request);
    const status = STATUSES.find((value) => value === body?.status);
    if (!isUuid(id) || !status) return jsonError("Invalid request.", 400);

    const admin = createSupabaseAdminClient();
    const { data: appointment, error } = await admin
      .from("crm_appointments")
      .select("id, contact_id, staff_id, scheduled_at, visit_id")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!appointment) return jsonError("Appointment not found.", 404);

    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "showed" && !appointment.visit_id) {
      const { data: visit, error: visitError } = await admin
        .from("guest_visits")
        .insert({
          organization_id: staff.organizationId,
          contact_id: appointment.contact_id,
          visit_type: "appointment",
          // Counted on the appointment's date, even if marked later.
          visit_at: appointment.scheduled_at,
          assigned_staff_id: appointment.staff_id,
          created_by_staff_id: staff.id,
        })
        .select("id")
        .single();
      if (visitError) throw visitError;
      update.visit_id = visit.id;
    }

    const { error: updateError } = await admin
      .from("crm_appointments")
      .update(update)
      .eq("id", id)
      .eq("organization_id", staff.organizationId);
    if (updateError) throw updateError;
    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/appointments PATCH", error);
    return jsonError("Couldn't update the appointment.", 500);
  }
}
