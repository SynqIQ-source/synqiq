import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateNew } from "@/lib/classes/catalog-edits";
import { buildClassCalendar } from "@/lib/sync/class-calendar";

type RouteParams = { params: Promise<{ entity: string }> };

// Club Admins create a class type or a class time in SynqIQ (source
// 'synqiq'; Mindbody's import never touches it). It goes on SynqIQ's
// calendar right away. Until the switch it isn't in Mindbody, so members
// can't book it there.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { entity } = await params;
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  if (entity !== "class_type" && entity !== "class_schedule") {
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const orgId = currentStaff.organizationId;
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;
  const result = validateNew(entity, body, today);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  const values = result.values;

  let row: Record<string, unknown>;
  if (entity === "class_type") {
    const { data: program } = await admin
      .from("departments")
      .select("id")
      .eq("organization_id", orgId)
      .eq("mindbody_program_id", values.mindbody_program_id as number)
      .maybeSingle();
    if (!program) return NextResponse.json({ success: false, error: "Pick one of the studio's programs." }, { status: 400 });
    row = {
      organization_id: orgId,
      source: "synqiq",
      name: values.name,
      mindbody_program_id: values.mindbody_program_id,
      description_text: values.description_text,
      level: values.level,
      category: values.category,
      active: true,
      created_by_staff_id: currentStaff.id,
    };
  } else {
    const { data: type } = await admin
      .from("class_types")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("id", values.class_type_id as string)
      .maybeSingle();
    if (!type) return NextResponse.json({ success: false, error: "Pick one of the studio's classes." }, { status: 400 });
    if (values.mindbody_resource_id) {
      const { data: room } = await admin
        .from("rooms")
        .select("id")
        .eq("organization_id", orgId)
        .eq("mindbody_resource_id", values.mindbody_resource_id as number)
        .maybeSingle();
      if (!room) return NextResponse.json({ success: false, error: "Pick one of the studio's rooms." }, { status: 400 });
    }
    if (values.staff_mindbody_id) {
      const { data: teacher } = await admin
        .from("staff")
        .select("id")
        .eq("organization_id", orgId)
        .eq("mindbody_staff_id", values.staff_mindbody_id as number)
        .maybeSingle();
      if (!teacher) return NextResponse.json({ success: false, error: "Pick one of the studio's instructors." }, { status: 400 });
    }
    row = {
      organization_id: orgId,
      source: "synqiq",
      class_type_id: type.id,
      class_name: type.name,
      days: values.days,
      start_time: values.start_time,
      end_time: values.end_time,
      start_date: values.start_date,
      end_date: values.end_date,
      frequency_type: "Weekly",
      frequency_interval: 1,
      mindbody_resource_id: values.mindbody_resource_id,
      capacity: values.capacity,
      web_capacity: values.capacity,
      staff_mindbody_id: values.staff_mindbody_id,
      created_by_staff_id: currentStaff.id,
    };
  }

  const table = entity === "class_type" ? "class_types" : "class_schedules";
  const { data: created, error } = await admin.from(table).insert(row).select("id").single();
  if (error) {
    console.error("[catalog-create] insert failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  await admin.from("catalog_edits").insert({
    organization_id: orgId,
    entity,
    row_id: created.id,
    changes: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, { from: null, to: value }])),
    edited_by_staff_id: currentStaff.id,
    note: "Created in SynqIQ",
  });
  if (entity === "class_schedule") {
    const rebuilt = await buildClassCalendar(orgId);
    if (!rebuilt.success) console.error("[catalog-create] calendar rebuild failed:", rebuilt.error);
  }
  return NextResponse.json({ success: true, id: created.id });
}
