"use client";

import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { createRealtimeAuthedBrowserClient, createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { StaffOption } from "@/lib/staff";
import type { RealtimeChannel } from "@supabase/supabase-js";

type BoardType = "announcements" | "group_department" | "sub_specific";

type Board = {
  id: string;
  board_type: BoardType;
  title: string;
  department_id: string | null;
  substitution_request_id: string | null;
  created_at: string;
};

type Message = {
  id: string;
  author_staff_id: string;
  body: string;
  created_at: string;
};

type MessageBoardsClientProps = {
  currentStaffId: string;
  currentStaffRole: "admin" | "instructor";
  initialBoards: Board[];
  staffDirectory: StaffOption[];
};

const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  announcements: "Announcements",
  group_department: "Department Chats",
  sub_specific: "Coverage Chats",
};

const BOARD_TYPE_ORDER: BoardType[] = ["announcements", "group_department", "sub_specific"];

export function MessageBoardsClient({
  currentStaffId,
  currentStaffRole,
  initialBoards,
  staffDirectory,
}: MessageBoardsClientProps) {
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(
    initialBoards[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [accessRevokedNotice, setAccessRevokedNotice] = useState(false);

  // Lets the long-lived membership subscription below (subscribed once per
  // mount, not re-subscribed on every board switch) read whichever board is
  // *currently* open without its closure going stale.
  const selectedBoardIdRef = useRef(selectedBoardId);
  useEffect(() => {
    selectedBoardIdRef.current = selectedBoardId;
  }, [selectedBoardId]);

  const nameById = new Map(staffDirectory.map((staff) => [staff.id, staff.display_name]));

  // New boards becoming visible live -- e.g. a sub-specific chat created the
  // moment a substitution request is approved. RLS already filters this to
  // boards I can actually see.
  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    // Realtime specifically needs createRealtimeAuthedBrowserClient(), not
    // the plain browser client -- see that function's comment. The plain
    // client's cookie-based session hydration is async, so a subscribe
    // called right after creating it can silently authenticate as anon.
    createRealtimeAuthedBrowserClient().then((supabase) => {
      if (cancelled) {
        return;
      }
      channel = supabase
        .channel("message-boards-list")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "message_boards" },
          (payload) => {
            const newBoard = payload.new as Board;
            setBoards((prev) =>
              prev.some((board) => board.id === newBoard.id) ? prev : [...prev, newBoard],
            );
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  // My own membership changing live. This is the part that makes losing
  // access to a board actually remove it from view -- RLS already stops new
  // messages from arriving the instant access is revoked (that part needs
  // no extra wiring), but without this the board would just sit there
  // looking normal, frozen on whatever was last loaded. UPDATE, not DELETE:
  // board_members is soft-delete only, precisely so this subscription can
  // see removals at all -- Realtime's postgres_changes does not apply RLS
  // to DELETE events, so a hard delete wouldn't be safe to filter this way.
  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    createRealtimeAuthedBrowserClient().then((supabase) => {
      if (cancelled) {
        return;
      }
      channel = supabase
        .channel(`board-membership-${currentStaffId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "board_members",
            filter: `staff_id=eq.${currentStaffId}`,
          },
          (payload) => {
            const membership = payload.new as { board_id: string; removed_at: string | null };
            if (!membership.removed_at) {
              return; // re-added (removed_at cleared), not a removal
            }

            setBoards((prev) => prev.filter((board) => board.id !== membership.board_id));

            if (selectedBoardIdRef.current === membership.board_id) {
              setSelectedBoardId(null);
              setAccessRevokedNotice(true);
            }
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, [currentStaffId]);

  // Messages for whichever board is open: initial fetch, then live INSERTs
  // scoped to that one board via a per-board filter. Re-subscribes on every
  // board switch, unlike the two subscriptions above.
  useEffect(() => {
    if (!selectedBoardId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    setLoadingMessages(true);
    setAccessRevokedNotice(false);

    // Plain read -- the ordinary browser client is fine here, only the
    // .channel() subscription below needs the realtime-authed one.
    createSupabaseBrowserClient()
      .from("board_messages")
      .select("id, author_staff_id, body, created_at")
      .eq("board_id", selectedBoardId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) {
          return;
        }
        if (error) {
          console.error("Failed to load messages:", error.message);
          setMessages([]);
        } else {
          setMessages(data ?? []);
        }
        setLoadingMessages(false);
      });

    createRealtimeAuthedBrowserClient().then((supabase) => {
      if (cancelled) {
        return;
      }
      channel = supabase
        .channel(`board-messages-${selectedBoardId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "board_messages",
            filter: `board_id=eq.${selectedBoardId}`,
          },
          (payload) => {
            // Dedups against handleSend's own optimistic append below --
            // both use the same DB-generated id, so a message I just sent
            // myself doesn't show up twice when this subscription echoes
            // it back.
            const newMessage = payload.new as Message;
            setMessages((prev) =>
              prev.some((message) => message.id === newMessage.id) ? prev : [...prev, newMessage],
            );
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, [selectedBoardId]);

  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? null;
  const canPost =
    selectedBoard !== null &&
    (selectedBoard.board_type !== "announcements" || currentStaffRole === "admin");

  async function handleSend() {
    const body = draft.trim();
    if (!body || !selectedBoardId || sending) {
      return;
    }

    setSending(true);
    const supabase = createSupabaseBrowserClient();
    // Direct client-side write, no API route -- RLS is the actual boundary
    // here (board_messages_insert_can_access already requires
    // author_staff_id to match the caller's own session-derived identity),
    // so there's no server-side check this route would add beyond what the
    // database already enforces.
    const { data, error } = await supabase
      .from("board_messages")
      .insert({ board_id: selectedBoardId, author_staff_id: currentStaffId, body })
      .select("id, author_staff_id, body, created_at")
      .single();

    setSending(false);

    if (error) {
      console.error("Failed to send message:", error.message);
      return;
    }

    if (data) {
      setMessages((prev) => [...prev, data]);
      setDraft("");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-6">
        {BOARD_TYPE_ORDER.map((type) => {
          const boardsOfType = boards.filter((board) => board.board_type === type);
          if (boardsOfType.length === 0) {
            return null;
          }

          return (
            <div key={type}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {BOARD_TYPE_LABELS[type]}
              </h3>
              <div className="mt-2 flex flex-col gap-1">
                {boardsOfType.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => setSelectedBoardId(board.id)}
                    className={`rounded-md px-3 py-2 text-left text-sm font-medium ${
                      board.id === selectedBoardId
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    {board.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {boards.length === 0 ? (
          <p className="text-sm text-zinc-500">No boards available yet.</p>
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white">
        {!selectedBoard ? (
          <div className="p-6 text-sm text-zinc-500">
            {accessRevokedNotice
              ? "You no longer have access to this board."
              : "Select a board to view messages."}
          </div>
        ) : (
          <div className="flex h-[32rem] flex-col">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="text-base font-semibold text-zinc-950">{selectedBoard.title}</h2>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {loadingMessages ? (
                <p className="text-sm text-zinc-500">Loading...</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-zinc-500">No messages yet.</p>
              ) : (
                messages.map((message) => (
                  <div key={message.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-zinc-950">
                        {nameById.get(message.author_staff_id) ?? "Unknown"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {DateTime.fromISO(message.created_at).toFormat("MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-700">{message.body}</p>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-zinc-200 p-4">
              {canPost ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Write a message..."
                    className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !draft.trim()}
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">Only admins can post announcements.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
