import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";
import { cleanLayout } from "@/lib/rooms/layout";

// Club Admin: save (PUT { columns, rows, items, spotNoun, active }) or remove
// (DELETE) a room's layout. Bookings keep the spot label they were given.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return fail("Room not found.", 404);
  const org = auth.currentStaff.organizationId;
  const admin = createSupabaseAdminClient();
  const { data: room } = await admin.from("rooms").select("id").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!room) return fail("Room not found.", 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const cleaned = cleanLayout(body);
  if ("error" in cleaned) return fail(cleaned.error);
  const { layout } = cleaned;
  const { error } = await admin.from("room_layouts").upsert(
    {
      organization_id: org,
      room_id: id,
      columns: layout.columns,
      rows: layout.rows,
      items: layout.items,
      spot_noun: layout.spotNoun,
      active: body?.active !== false,
      updated_at: new Date().toISOString(),
      updated_by_staff_id: auth.currentStaff.id,
    },
    { onConflict: "room_id" },
  );
  if (error) {
    console.error("[rooms/layout] save failed:", error.message);
    return fail("Couldn't save. Try again.", 500);
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return fail("Room not found.", 404);
  await createSupabaseAdminClient().from("room_layouts").delete().eq("room_id", id).eq("organization_id", auth.currentStaff.organizationId);
  return NextResponse.json({ success: true });
}
