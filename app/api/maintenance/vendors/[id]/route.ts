import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { vendorValues } from "@/lib/maintenance/catalog";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admins edit a vendor, or archive it ({ archived: true }).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin")
    return NextResponse.json({ success: false, error: "Only a Club Admin can do this." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let update: Record<string, unknown>;
  if (typeof body?.archived === "boolean") {
    update = { archived_at: body.archived ? new Date().toISOString() : null };
  } else {
    const parsed = vendorValues(body);
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    update = parsed.values;
  }
  const { data, error } = await createSupabaseAdminClient()
    .from("maintenance_vendors")
    .update(update)
    .eq("id", id)
    .eq("organization_id", staff.organizationId)
    .select("id");
  if (error) return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
