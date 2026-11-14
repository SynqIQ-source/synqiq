import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";
import { cleanLayout } from "@/lib/rooms/layout";

// Club Admin: a room's layouts. A room has one default layout and may have
// others used only by certain class types (Beat on mats in the Cycle room).
//   PUT { layoutId?, name, isDefault, classTypeIds[], columns, rows, items, spotNoun }
//       saves (no layoutId = a new layout)
//   DELETE ?layoutId=  removes one
// Bookings keep the spot label they were given.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id: roomId } = await params;
  if (!isUuid(roomId)) return fail("Room not found.", 404);
  const org = auth.currentStaff.organizationId;
  const admin = createSupabaseAdminClient();
  const { data: room } = await admin.from("rooms").select("id").eq("id", roomId).eq("organization_id", org).maybeSingle();
  if (!room) return fail("Room not found.", 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const cleaned = cleanLayout(body);
  if ("error" in cleaned) return fail(cleaned.error);
  const { layout } = cleaned;
  const layoutId = isUuid(body?.layoutId) ? (body?.layoutId as string) : null;
  const isDefault = body?.isDefault === true;
  const name =
    String(body?.name ?? "")
      .trim()
      .slice(0, 40) || (isDefault ? "Main layout" : "Layout");
  const classTypeIds = [...new Set((Array.isArray(body?.classTypeIds) ? body.classTypeIds : []).filter(isUuid))] as string[];
  if (!isDefault && classTypeIds.length === 0) return fail("Pick the classes that use this layout, or make it the room's main layout.");

  if (classTypeIds.length) {
    const { data: types } = await admin.from("class_types").select("id").eq("organization_id", org).in("id", classTypeIds);
    if ((types ?? []).length !== classTypeIds.length) return fail("One of those classes wasn't found.");
  }
  // A class type can use only one layout in a room.
  const { data: others } = await admin.from("room_layouts").select("id, name, class_type_ids, is_default").eq("room_id", roomId);
  const clash = (others ?? []).find(
    (other) => other.id !== layoutId && ((other.class_type_ids as string[] | null) ?? []).some((typeId) => classTypeIds.includes(typeId)),
  );
  if (clash) return fail(`One of those classes already uses the "${clash.name as string}" layout. Take it off there first.`);

  const now = new Date().toISOString();
  // Only one main layout per room.
  if (isDefault) {
    await admin
      .from("room_layouts")
      .update({ is_default: false, updated_at: now })
      .eq("room_id", roomId)
      .eq("is_default", true)
      .neq("id", layoutId ?? "00000000-0000-0000-0000-000000000000");
  }
  const row = {
    organization_id: org,
    room_id: roomId,
    name,
    is_default: isDefault,
    class_type_ids: classTypeIds,
    columns: layout.columns,
    rows: layout.rows,
    items: layout.items,
    spot_noun: layout.spotNoun,
    active: true,
    updated_at: now,
    updated_by_staff_id: auth.currentStaff.id,
  };
  const { data: saved, error } = layoutId
    ? await admin.from("room_layouts").update(row).eq("id", layoutId).eq("room_id", roomId).select("id").maybeSingle()
    : await admin.from("room_layouts").insert(row).select("id").single();
  if (error || !saved) {
    console.error("[rooms/layout] save failed:", error?.message);
    return fail("Couldn't save. Try again.", 500);
  }
  return NextResponse.json({ success: true, id: saved.id });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id: roomId } = await params;
  const layoutId = request.nextUrl.searchParams.get("layoutId");
  if (!isUuid(roomId) || !isUuid(layoutId)) return fail("Layout not found.", 404);
  await createSupabaseAdminClient()
    .from("room_layouts")
    .delete()
    .eq("id", layoutId)
    .eq("room_id", roomId)
    .eq("organization_id", auth.currentStaff.organizationId);
  return NextResponse.json({ success: true });
}
