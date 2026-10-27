import { DateTime } from "luxon";
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
  substitution_request: {
    occurrence: { start_datetime: string | null; end_datetime: string | null } | null;
  } | null;
};

export type BoardWithClassDate = Omit<BoardRow, "substitution_request"> & {
  // Coverage chats only: when the covered class happens (org-local label)
  // and whether it's already over -- so an admin can tell at a glance which
  // chats are safe to delete.
  classDateLabel: string | null;
  classStart: string | null;
  classEnded: boolean;
};

async function getBoards(supabase: ScopedSupabaseClient) {
  const { data, error } = await supabase
    .from("message_boards")
    .select(
      `id, board_type, title, department_id, substitution_request_id, created_at,
       substitution_request:substitution_requests!message_boards_substitution_request_id_fkey (
         occurrence:class_occurrences!substitution_requests_occurrence_id_fkey ( start_datetime, end_datetime )
       )`,
    )
    .eq("active", true)
    .order("created_at", { ascending: true })
    .returns<BoardRow[]>();

  if (error) {
    throw new Error(`Failed to load message boards: ${error.message}`);
  }

  return data ?? [];
}

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

function withClassDates(boards: BoardRow[], timezone: string): BoardWithClassDate[] {
  const now = DateTime.utc();
  return boards.map(({ substitution_request, ...board }) => {
    const occurrence = substitution_request?.occurrence;
    const start = occurrence?.start_datetime ? DateTime.fromISO(occurrence.start_datetime, { zone: "utc" }) : null;
    const endIso = occurrence?.end_datetime ?? occurrence?.start_datetime ?? null;
    return {
      ...board,
      // Class names from Mindbody can carry stray spaces (" Mat Fusion").
      title: board.title.replace(/\s+/g, " ").trim(),
      classStart: occurrence?.start_datetime ?? null,
      classDateLabel: start ? start.setZone(timezone).toFormat("ccc, LLL d · h:mm a") : null,
      classEnded: endIso ? DateTime.fromISO(endIso, { zone: "utc" }) < now : false,
    };
  });
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
  const [rawBoards, staffDirectory, timezone] = await Promise.all([
    getBoards(supabase),
    getActiveStaff(),
    getOrgTimezone(supabase),
  ]);
  const boards = withClassDates(rawBoards, timezone);

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
