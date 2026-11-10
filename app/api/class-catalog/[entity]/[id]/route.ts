import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_TABLES, applyCatalogEdit, isCatalogEntity } from "@/lib/classes/catalog-edits";
import { buildClassCalendar } from "@/lib/sync/class-calendar";

type RouteParams = { params: Promise<{ entity: string; id: string }> };

// Club Admins edit a class-catalog item (class type, schedule, room,
// program booking rules, session type). Stored in the row's `edits` (wins
// over Mindbody's copy, survives the nightly import) and logged in
// catalog_edits. Written with the service role after the role check, so
// only `edits` can change. Mindbody isn't changed.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { entity, id } = await params;
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  if (!isCatalogEntity(entity) || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { set?: Record<string, unknown>; reset?: string[] } | null;
  if (!body || (typeof body.set !== "object" && !Array.isArray(body.reset))) {
    return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const orgId = currentStaff.organizationId;
  const table = CATALOG_TABLES[entity];
  const { data: row } = await admin.from(table).select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (!row) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });

  // A room or instructor must be this studio's.
  const set = body.set ?? {};
  if (set.mindbody_resource_id !== undefined && set.mindbody_resource_id !== null && set.mindbody_resource_id !== "") {
    const { data: room } = await admin
      .from("rooms")
      .select("id")
      .eq("organization_id", orgId)
      .eq("mindbody_resource_id", Number(set.mindbody_resource_id))
      .maybeSingle();
    if (!room) return NextResponse.json({ success: false, error: "Pick one of the studio's rooms." }, { status: 400 });
  }
  if (set.staff_mindbody_id !== undefined && set.staff_mindbody_id !== null && set.staff_mindbody_id !== "") {
    const { data: teacher } = await admin
      .from("staff")
      .select("id")
      .eq("organization_id", orgId)
      .eq("mindbody_staff_id", Number(set.staff_mindbody_id))
      .maybeSingle();
    if (!teacher) return NextResponse.json({ success: false, error: "Pick one of the studio's instructors." }, { status: 400 });
  }

  const result = applyCatalogEdit(entity, row as Record<string, unknown> & { edits?: Record<string, never> }, body);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  if (!Object.keys(result.changes).length) return NextResponse.json({ success: true, changed: 0 });

  const { error } = await admin.from(table).update({ edits: result.edits }).eq("id", id).eq("organization_id", orgId);
  if (error) {
    console.error("[catalog-edit] save failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  const { error: logError } = await admin.from("catalog_edits").insert({
    organization_id: orgId,
    entity,
    row_id: id,
    changes: result.changes,
    edited_by_staff_id: currentStaff.id,
  });
  if (logError) console.error("[catalog-edit] change log failed:", logError.message);
  // Class types and class times feed SynqIQ's calendar.
  if (entity === "class_type" || entity === "class_schedule") {
    const rebuilt = await buildClassCalendar(orgId);
    if (!rebuilt.success) console.error("[catalog-edit] calendar rebuild failed:", rebuilt.error);
  }
  return NextResponse.json({ success: true, changed: Object.keys(result.changes).length });
}
