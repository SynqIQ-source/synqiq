import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SubstitutionResponseStatus = "interested" | "declined";

type Interest = {
  id: string;
  requestId: string;
  staffId: string;
  status: SubstitutionResponseStatus;
  respondedAt: string;
};

export type RespondResult =
  | { ok: true; interest: Interest; alreadyResponded: boolean }
  | { ok: false; httpStatus: number; error: string; existingStatus?: SubstitutionResponseStatus };

/**
 * Shared logic for both /interest and /decline: validates the request is
 * open, the staff member isn't the occurrence's own assigned instructor,
 * and they're actually eligible for this department+class_name -- then
 * records the response. A repeated identical response is idempotent; a
 * differing second response (e.g. declining after already expressing
 * interest) is rejected -- first response is locked in, never silently
 * overwritten.
 */
export async function respondToSubstitutionRequest(
  requestId: string,
  staffId: string,
  status: SubstitutionResponseStatus,
): Promise<RespondResult> {
  const supabase = createSupabaseAdminClient();

  const { data: substitutionRequest, error: requestError } = await supabase
    .from("substitution_requests")
    .select("id, status, occurrence_id")
    .eq("id", requestId)
    .single();

  if (requestError || !substitutionRequest) {
    return { ok: false, httpStatus: 404, error: "Substitution request not found." };
  }

  // Status stays 'open' for the entire response-gathering window, only
  // moving straight to approved/completed/cancelled when a manager selects
  // -- pending_selection is a defined value in the status CHECK constraint
  // but isn't used anywhere in this workflow.
  if (substitutionRequest.status !== "open") {
    return {
      ok: false,
      httpStatus: 409,
      error: `This request is no longer accepting responses (status: ${substitutionRequest.status}).`,
    };
  }

  const { data: occurrence, error: occurrenceError } = await supabase
    .from("class_occurrences")
    .select("department_id, class_name, staff_id")
    .eq("id", substitutionRequest.occurrence_id)
    .single();

  if (occurrenceError || !occurrence) {
    return {
      ok: false,
      httpStatus: 500,
      error: occurrenceError?.message ?? "Could not resolve the request's class occurrence.",
    };
  }

  if (occurrence.staff_id && staffId === occurrence.staff_id) {
    return {
      ok: false,
      httpStatus: 403,
      error: "The currently assigned instructor cannot respond to their own class's substitution request.",
    };
  }

  // Safety check even though the UI should only ever show eligible
  // instructors -- don't trust the client to have enforced this.
  if (!occurrence.department_id || !occurrence.class_name) {
    return {
      ok: false,
      httpStatus: 409,
      error: "This request's class occurrence has no resolved department -- eligibility cannot be verified.",
    };
  }

  const { data: eligibilityRow, error: eligibilityError } = await supabase
    .from("instructor_class_eligibility")
    .select("id")
    .eq("staff_id", staffId)
    .eq("department_id", occurrence.department_id)
    .eq("class_name", occurrence.class_name.trim())
    .eq("enabled", true)
    .maybeSingle();

  if (eligibilityError) {
    return { ok: false, httpStatus: 500, error: eligibilityError.message };
  }

  if (!eligibilityRow) {
    return {
      ok: false,
      httpStatus: 403,
      error: "This staff member is not eligible to respond to this request.",
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("substitution_interests")
    .select("id, status, responded_at")
    .eq("request_id", requestId)
    .eq("staff_id", staffId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, httpStatus: 500, error: existingError.message };
  }

  if (existing) {
    if (existing.status === status) {
      return {
        ok: true,
        alreadyResponded: true,
        interest: {
          id: existing.id,
          requestId,
          staffId,
          status: existing.status as SubstitutionResponseStatus,
          respondedAt: existing.responded_at,
        },
      };
    }

    return {
      ok: false,
      httpStatus: 409,
      error: `This staff member already responded '${existing.status}' and cannot change it to '${status}'.`,
      existingStatus: existing.status as SubstitutionResponseStatus,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("substitution_interests")
    .insert({ request_id: requestId, staff_id: staffId, status })
    .select("id, request_id, staff_id, status, responded_at")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      httpStatus: 500,
      error: insertError?.message ?? "Failed to record response.",
    };
  }

  return {
    ok: true,
    alreadyResponded: false,
    interest: {
      id: inserted.id,
      requestId: inserted.request_id,
      staffId: inserted.staff_id,
      status: inserted.status as SubstitutionResponseStatus,
      respondedAt: inserted.responded_at,
    },
  };
}
