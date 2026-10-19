import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type SubBoardRow = {
  id: string;
  substitution_request: {
    occurrence: { start_datetime: string | null; end_datetime: string | null } | null;
  } | null;
};

// A sub-specific board (created when a sub is approved, for the requester
// and the covering instructor) only matters until the class is over. Once
// it has ended, the board is archived (active = false), which hides it from
// Message Boards for everyone.
//
// Archived, never hard-deleted: Realtime's postgres_changes doesn't apply
// RLS to DELETE events (see 20260719232838_message_boards.sql), and the
// conversation stays on record. Runs from the nightly class sync.
export async function archivePastSubBoards(supabase: SupabaseAdminClient, organizationId: string): Promise<number> {
  const { data, error } = await supabase
    .from("message_boards")
    .select(
      `id,
       substitution_request:substitution_requests!message_boards_substitution_request_id_fkey (
         occurrence:class_occurrences!substitution_requests_occurrence_id_fkey ( start_datetime, end_datetime )
       )`,
    )
    .eq("organization_id", organizationId)
    .eq("board_type", "sub_specific")
    .eq("active", true)
    .returns<SubBoardRow[]>();

  if (error) {
    throw new Error(`Failed to load sub boards: ${error.message}`);
  }

  const now = Date.now();
  const pastIds = (data ?? [])
    .filter((board) => {
      const occurrence = board.substitution_request?.occurrence;
      const endsAt = occurrence?.end_datetime ?? occurrence?.start_datetime;
      return endsAt != null && new Date(endsAt).getTime() < now;
    })
    .map((board) => board.id);

  if (pastIds.length === 0) {
    return 0;
  }

  const { error: updateError } = await supabase.from("message_boards").update({ active: false }).in("id", pastIds);

  if (updateError) {
    throw new Error(`Failed to archive past sub boards: ${updateError.message}`);
  }

  return pastIds.length;
}
