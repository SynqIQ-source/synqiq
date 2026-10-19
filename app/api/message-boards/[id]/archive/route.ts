import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

type RouteParams = { params: Promise<{ id: string }> };

// Admin "delete" for a sub-specific message board. Archives it
// (active = false) rather than deleting the row -- hard deletes bypass
// Realtime's RLS filtering (see 20260719232838_message_boards.sql), and the
// conversation stays on record. Only sub_specific boards: the announcements
// and per-department boards are permanent fixtures.
//
// The RLS-scoped client is the real boundary (message_boards_update_admin:
// admin + same org); the role check here just returns a clear error.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { id: boardId } = await params;
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can delete a message board." }, { status: 403 });
    }

    const supabase = await getScopedClient(currentStaff);

    const { data: archived, error } = await supabase
      .from("message_boards")
      .update({ active: false })
      .eq("id", boardId)
      .eq("board_type", "sub_specific")
      .select("id");

    if (error) {
      throw new Error(error.message);
    }

    if (!archived || archived.length === 0) {
      return NextResponse.json({ error: "Sub board not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
