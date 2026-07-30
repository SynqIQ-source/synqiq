import { DashboardShell } from "@/components/dashboard-shell";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
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
        <StaffNotProvisioned />
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
