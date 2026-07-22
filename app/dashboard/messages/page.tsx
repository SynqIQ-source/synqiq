import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { getActiveStaff } from "@/lib/staff";
import { MessageBoardsClient } from "./message-boards-client";

type BoardRow = {
  id: string;
  board_type: "announcements" | "group_department" | "sub_specific";
  title: string;
  department_id: string | null;
  substitution_request_id: string | null;
  created_at: string;
};

async function getBoards(supabase: ScopedSupabaseClient) {
  const { data, error } = await supabase
    .from("message_boards")
    .select("id, board_type, title, department_id, substitution_request_id, created_at")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .returns<BoardRow[]>();

  if (error) {
    throw new Error(`Failed to load message boards: ${error.message}`);
  }

  return data ?? [];
}

export default async function MessagesPage() {
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return (
      <DashboardShell
        title="Message Boards"
        description="Announcements, department chats, and coverage chats."
      >
        <section className="rounded-lg border border-zinc-200 bg-white p-6">
          <h2 className="text-base font-semibold text-zinc-950">Sign in required</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Message Boards has no &quot;select your name&quot; fallback -- access to each board is
            enforced by the database itself based on who you&apos;re actually logged in as, not a
            client-supplied name.{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>{" "}
            to continue.
          </p>
        </section>
      </DashboardShell>
    );
  }

  const supabase = await getScopedClient(currentStaff);
  const [boards, staffDirectory] = await Promise.all([
    getBoards(supabase),
    getActiveStaff(),
  ]);

  return (
    <DashboardShell
      title="Message Boards"
      description="Announcements, department chats, and coverage chats."
    >
      <MessageBoardsClient
        currentStaffId={currentStaff.id}
        currentStaffRole={currentStaff.role}
        initialBoards={boards}
        staffDirectory={staffDirectory}
      />
    </DashboardShell>
  );
}
