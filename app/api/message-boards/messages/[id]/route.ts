import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admin: delete one post from any board. Hidden from everyone, kept
// in the database with who deleted it and when.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff))
    return NextResponse.json({ success: false, error: "Only a Club Admin can delete posts." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { data: message } = await admin.from("board_messages").select("id, board_id").eq("id", id).maybeSingle();
  if (!message) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const { data: board } = await admin
    .from("message_boards")
    .select("id")
    .eq("id", message.board_id)
    .eq("organization_id", staff.organizationId)
    .maybeSingle();
  if (!board) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const { error } = await admin
    .from("board_messages")
    .update({ deleted_at: new Date().toISOString(), deleted_by_staff_id: staff.id })
    .eq("id", id);
  if (error) return NextResponse.json({ success: false, error: "Couldn't delete. Try again." }, { status: 500 });
  return NextResponse.json({ success: true });
}
