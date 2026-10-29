import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Books an appointment for a guest (admins and sellers). The time comes from
// a date-time picker in the studio's local time ("2026-11-03T17:30").
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Guest not found.", 404);
    const body = await readJsonBody(request);
    const raw = typeof body?.scheduledAt === "string" ? body.scheduledAt : "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return jsonError("Pick a date and time.", 400);

    const org = await getCrmOrg(staff.organizationId);
    const when = DateTime.fromISO(raw, { zone: org.timezone });
    if (!when.isValid) return jsonError("Pick a valid date and time.", 400);
    if (when < DateTime.now().minus({ days: 1 }) || when > DateTime.now().plus({ days: 366 })) {
      return jsonError("Pick a date within the next year.", 400);
    }

    const admin = createSupabaseAdminClient();
    const { data: contact, error } = await admin
      .from("crm_contacts")
      .select("id, assigned_staff_id")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .maybeSingle();
    if (error) throw error;
    if (!contact) return jsonError("Guest not found.", 404);

    let staffId: string | null = contact.assigned_staff_id ?? staff.id;
    if (body?.staffId !== undefined) {
      if (body.staffId === null || body.staffId === "") staffId = null;
      else if (!isUuid(body.staffId)) return jsonError("Pick someone from the list.", 400);
      else {
        const { data: member } = await admin
          .from("staff")
          .select("id")
          .eq("id", body.staffId)
          .eq("organization_id", staff.organizationId)
          .is("archived_at", null)
          .maybeSingle();
        if (!member) return jsonError("Pick someone from the list.", 400);
        staffId = member.id;
      }
    }

    const { error: insertError } = await admin.from("crm_appointments").insert({
      organization_id: staff.organizationId,
      contact_id: id,
      staff_id: staffId,
      scheduled_at: when.toUTC().toISO(),
      created_by_staff_id: staff.id,
    });
    if (insertError) throw insertError;

    // Booking makes the guest theirs if nobody was assigned yet.
    if (!contact.assigned_staff_id && staffId) {
      await admin.from("crm_contacts").update({ assigned_staff_id: staffId }).eq("id", id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/appointments POST", error);
    return jsonError("Couldn't book the appointment.", 500);
  }
}
