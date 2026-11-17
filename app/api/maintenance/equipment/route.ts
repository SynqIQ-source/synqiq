import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { runsMaintenance } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { equipmentValues } from "@/lib/maintenance/catalog";
import { checkOwnerAndVendor } from "./shared";

// Club Admins and Facility Techs add equipment to the register.
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !runsMaintenance(staff))
    return NextResponse.json({ success: false, error: "Only a Club Admin or Facility Tech can do this." }, { status: 403 });
  const parsed = equipmentValues((await request.json().catch(() => null)) as Record<string, unknown> | null);
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const problem = await checkOwnerAndVendor(admin, staff.organizationId, parsed.values);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
  const { data, error } = await admin
    .from("maintenance_equipment")
    .insert({ ...parsed.values, organization_id: staff.organizationId })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}
