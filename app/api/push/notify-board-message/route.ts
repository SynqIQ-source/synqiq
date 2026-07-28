import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { sendPushToStaff } from "@/lib/push/send";

// Message posting itself is a direct client-side insert into board_messages
// (RLS is the real boundary there -- see message-boards-client.tsx), not a
// server route, since sending push requires the VAPID *private* key which
// can only ever be used server-side. The client calls this route as a
// fire-and-forget follow-up right after a successful insert.
//
// Authorization here is exactly "can this caller see this message" --
// board_messages_select_can_access and board_members_select_can_access both
// gate on private.can_access_board(), so the RLS-scoped client (not the
// admin client) is what actually enforces "only notify for a board the
// caller is really a member of."
export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();
    if (!currentStaff) {
      return NextResponse.json({ success: false, error: "Sign in required." }, { status: 403 });
    }

    const body = await request.json();
    const messageId: string | undefined = body?.messageId;

    if (!messageId) {
      return NextResponse.json({ success: false, error: "messageId is required." }, { status: 400 });
    }

    const supabase = await getScopedClient(currentStaff);

    const { data: message, error: messageError } = await supabase
      .from("board_messages")
      .select("id, board_id, author_staff_id, body")
      .eq("id", messageId)
      .single();

    if (messageError || !message) {
      return NextResponse.json({ success: false, error: "Message not found." }, { status: 404 });
    }

    const { data: board, error: boardError } = await supabase
      .from("message_boards")
      .select("title")
      .eq("id", message.board_id)
      .single();

    if (boardError || !board) {
      return NextResponse.json({ success: false, error: "Board not found." }, { status: 404 });
    }

    const { data: members, error: membersError } = await supabase
      .from("board_members")
      .select("staff_id")
      .eq("board_id", message.board_id)
      .is("removed_at", null);

    if (membersError) {
      throw new Error(membersError.message);
    }

    const recipientStaffIds = (members ?? [])
      .map((member) => member.staff_id)
      .filter((staffId) => staffId !== message.author_staff_id);

    const bodyPreview = message.body.length > 120 ? `${message.body.slice(0, 117)}...` : message.body;

    await sendPushToStaff(recipientStaffIds, {
      title: `New message in ${board.title}`,
      body: bodyPreview,
      url: "/dashboard/messages",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
