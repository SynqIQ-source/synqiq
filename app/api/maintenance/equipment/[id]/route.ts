import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { runsMaintenance } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { equipmentValues } from "@/lib/maintenance/catalog";
import { checkOwnerAndVendor } from "../shared";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admins and Facility Techs edit equipment; Club Admins retire it
// ({ archived: true }); history stays.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff || !runsMaintenance(staff))
    return NextResponse.json({ success: false, error: "Only a Club Admin or Facility Tech can do this." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  let update: Record<string, unknown>;
  if (typeof body?.archived === "boolean") {
    if (staff.role !== "admin")
      return NextResponse.json({ success: false, error: "Only a Club Admin can retire equipment." }, { status: 403 });
    update = { archived_at: body.archived ? new Date().toISOString() : null };
  } else {
    const parsed = equipmentValues(body);
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const problem = await checkOwnerAndVendor(admin, staff.organizationId, parsed.values);
    if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
    update = parsed.values;
  }
  const { data, error } = await admin
    .from("maintenance_equipment")
    .update(update)
    .eq("id", id)
    .eq("organization_id", staff.organizationId)
    .select("id");
  if (error) return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
