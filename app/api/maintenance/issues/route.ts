import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanText } from "@/lib/crm/normalize";
import { addEvent, notifyNewIssue, type EquipmentRow, type IssueRow } from "@/lib/maintenance/server";

// Any signed-in staff member reports a maintenance issue. Critical comes
// from the equipment (each club marks its critical pieces); for something
// not in the equipment list the reporter can flag it urgent. The owner and
// Club Admins are emailed right away (push too when critical).
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ success: false, error: "Sign in to report an issue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const title = cleanText(body?.title, 120);
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 4000) : "";
  const locationText = cleanText(body?.locationText, 200);
  const equipmentId = typeof body?.equipmentId === "string" && /^[0-9a-f-]{36}$/i.test(body.equipmentId) ? body.equipmentId : null;
  if (!title) return NextResponse.json({ success: false, error: "Add a short title (what's wrong)." }, { status: 400 });
  if (!description) return NextResponse.json({ success: false, error: "Describe the problem." }, { status: 400 });
  if (!equipmentId && !locationText)
    return NextResponse.json({ success: false, error: "Pick the equipment or say where it is." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  let equipment: EquipmentRow | null = null;
  if (equipmentId) {
    const { data } = await admin
      .from("maintenance_equipment")
      .select("id, name, area, model_number, serial_number, owner_staff_id, default_vendor_id, is_critical")
      .eq("id", equipmentId)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (!data) return NextResponse.json({ success: false, error: "Pick equipment from the list." }, { status: 400 });
    equipment = data as EquipmentRow;
  }

  const { data: created, error } = await admin
    .from("maintenance_issues")
    .insert({
      organization_id: staff.organizationId,
      equipment_id: equipment?.id ?? null,
      location_text: locationText,
      title,
      description,
      is_critical: equipment ? equipment.is_critical : body?.isCritical === true,
      reported_by_staff_id: staff.id,
      vendor_id: equipment?.default_vendor_id ?? null,
    })
    .select("*")
    .single();
  if (error || !created) {
    console.error("[maintenance] report failed:", error?.message);
    return NextResponse.json({ success: false, error: "Couldn't save the report. Try again." }, { status: 500 });
  }
  const issue = created as IssueRow;
  await addEvent(admin, {
    organization_id: staff.organizationId,
    issue_id: issue.id,
    kind: "reported",
    body: description,
    staff_id: staff.id,
  });
  // Media is uploaded next; the alert links to the report, where it shows.
  await notifyNewIssue(admin, issue, equipment, staff.displayName);
  return NextResponse.json({ success: true, id: issue.id, critical: issue.is_critical });
}
