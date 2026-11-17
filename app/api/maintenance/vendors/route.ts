import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { vendorValues } from "@/lib/maintenance/catalog";

// Club Admins add a vendor (company, contact, email and/or phone).
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin")
    return NextResponse.json({ success: false, error: "Only a Club Admin can do this." }, { status: 403 });
  const parsed = vendorValues((await request.json().catch(() => null)) as Record<string, unknown> | null);
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const { data, error } = await createSupabaseAdminClient()
    .from("maintenance_vendors")
    .insert({ ...parsed.values, organization_id: staff.organizationId })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}
