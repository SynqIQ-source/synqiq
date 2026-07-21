import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

// Non-terminal statuses -- an occurrence can't have two open/pending
// requests at once (guards against double-submission). 'approved' is
// non-terminal too, but is handled differently below: a new request
// supersedes it (the arranged substitute fell through) rather than being
// blocked by it. A prior request that reached a truly terminal state
// (completed/cancelled) never blocks a new one.
const NON_TERMINAL_STATUSES = ["open", "pending_selection", "approved"];

type QualifiedInstructor = {
  id: string;
  displayName: string;
  email: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const occurrenceId: string | undefined = body?.occurrenceId;
    const reason: string | undefined = body?.reason;

    // A real session's identity always wins over whatever the client sent --
    // the whole point of moving this route off the admin client is to stop
    // trusting a client-supplied requestedBy. No session yet (the ~137 staff
    // without a login) still trusts the body, same as before -- MindBody's
    // /usertoken/issue was investigated as a way to delegate identity for
    // them too, but its User.Id is a session-scoped artifact of the calling
    // API credential, not a stable Staff.Id (confirmed: two calls with the
    // identical site-owner credential returned different User.Id values,
    // neither of which exists anywhere in the real 137-row staff roster).
    const currentStaff = await getCurrentStaff();
    const requestedBy: string | undefined = currentStaff?.id ?? body?.requestedBy;

    if (!occurrenceId || !requestedBy) {
      return NextResponse.json(
        { error: "occurrenceId and requestedBy are required." },
        { status: 400 },
      );
    }

    const supabase = await getScopedClient(currentStaff);

    const { data: occurrence, error: occurrenceError } = await supabase
      .from("class_occurrences")
      .select("id, organization_id, department_id, class_name, staff_id")
      .eq("id", occurrenceId)
      .single();

    if (occurrenceError || !occurrence) {
      return NextResponse.json(
        { error: "Class occurrence not found." },
        { status: 404 },
      );
    }

    const { data: existingRequest, error: existingRequestError } = await supabase
      .from("substitution_requests")
      .select("id, status, requested_by")
      .eq("occurrence_id", occurrenceId)
      .in("status", NON_TERMINAL_STATUSES)
      .maybeSingle();

    if (existingRequestError) {
      throw new Error(existingRequestError.message);
    }

    let supersededRequestId: string | null = null;
    let substitutionRequest: Record<string, unknown> | null = null;

    if (existingRequest) {
      if (existingRequest.status !== "approved") {
        // open / pending_selection -- a genuinely unresolved request already
        // exists, don't allow a duplicate/parallel one.
        return NextResponse.json(
          {
            error: "An active substitution request already exists for this occurrence.",
            existingRequestId: existingRequest.id,
            existingStatus: existingRequest.status,
          },
          { status: 409 },
        );
      }

      // approved -- the previously-arranged substitute can no longer cover
      // this class after all. Close out the old approval (as 'cancelled',
      // same terminal status the manual /cancel endpoint uses) and clear the
      // occurrence's substitute assignment, then fall through to create a
      // fresh request below -- instead of leaving the class permanently
      // stuck on one approval. Either the original requester or the
      // instructor currently covering the class (from their own Schedule
      // page) can trigger this; a manager can too, as the original
      // requester's organization_id-scoped admin policy already covers.
      if (existingRequest.requested_by === requestedBy) {
        // Original requester -- substitution_requests_update_own /
        // insert_own already cover this caller directly, no RPC needed.
        const { error: supersedeError } = await supabase
          .from("substitution_requests")
          .update({ status: "cancelled", resolved_at: new Date().toISOString() })
          .eq("id", existingRequest.id);

        if (supersedeError) {
          throw new Error(supersedeError.message);
        }

        const { error: clearSubError } = await supabase
          .from("class_occurrences")
          .update({ substitute_staff_id: null })
          .eq("id", occurrenceId);

        if (clearSubError) {
          throw new Error(clearSubError.message);
        }

        supersededRequestId = existingRequest.id;
      } else {
        // Not the original requester -- almost always the covering
        // instructor backing out of their own approved assignment. They
        // have no direct UPDATE access to substitution_requests (by design:
        // see 20260720150000's comment on why a raw grant was rejected), so
        // the cancel-old + clear-substitute + insert-new sequence runs
        // atomically inside this SECURITY DEFINER function instead, which
        // itself verifies the caller is the occurrence's current
        // substitute_staff_id before doing anything.
        const { data: rpcRows, error: rpcError } = await supabase.rpc(
          "supersede_substitution_request",
          { p_occurrence_id: occurrenceId, p_reason: reason ?? null },
        );

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        const rpcResult = rpcRows?.[0];

        if (!rpcResult) {
          throw new Error("supersede_substitution_request returned no result.");
        }

        supersededRequestId = rpcResult.superseded_request_id;

        const { data: newRequest, error: newRequestError } = await supabase
          .from("substitution_requests")
          .select()
          .eq("id", rpcResult.new_request_id)
          .single();

        if (newRequestError || !newRequest) {
          throw new Error(newRequestError?.message ?? "Failed to load new substitution request.");
        }

        substitutionRequest = newRequest;
      }
    }

    if (!substitutionRequest) {
      const { data: inserted, error: insertError } = await supabase
        .from("substitution_requests")
        .insert({
          occurrence_id: occurrence.id,
          organization_id: occurrence.organization_id,
          requested_by: requestedBy,
          status: "open",
          reason: reason ?? null,
        })
        .select()
        .single();

      if (insertError || !inserted) {
        throw new Error(insertError?.message ?? "Failed to create substitution request.");
      }

      substitutionRequest = inserted;
    }

    // Only look up candidates if the occurrence actually resolved to a real
    // department -- without one there's nothing to match eligibility on, but
    // the request itself is still created (a manager can still ask for
    // coverage even if our own department mapping is incomplete).
    let qualifiedInstructors: QualifiedInstructor[] = [];

    if (occurrence.department_id && occurrence.class_name) {
      let eligibilityQuery = supabase
        .from("instructor_class_eligibility")
        .select(
          "staff:staff!instructor_class_eligibility_staff_id_fkey ( id, display_name, email )",
        )
        .eq("department_id", occurrence.department_id)
        .eq("class_name", occurrence.class_name.trim())
        .eq("enabled", true);

      // Exclude the instructor currently assigned to this occurrence -- they
      // need the sub, they aren't a candidate to cover themselves.
      if (occurrence.staff_id) {
        eligibilityQuery = eligibilityQuery.neq("staff_id", occurrence.staff_id);
      }

      const { data: eligibilityRows, error: eligibilityError } = await eligibilityQuery;

      if (eligibilityError) {
        throw new Error(eligibilityError.message);
      }

      qualifiedInstructors = (eligibilityRows ?? [])
        .map((row) => {
          const staff = row.staff as unknown as {
            id: string;
            display_name: string;
            email: string | null;
          } | null;
          return staff;
        })
        .filter((staff): staff is NonNullable<typeof staff> => staff !== null)
        .map((staff) => ({
          id: staff.id,
          displayName: staff.display_name,
          email: staff.email,
        }));
    }

    return NextResponse.json({
      success: true,
      request: substitutionRequest,
      departmentResolved: Boolean(occurrence.department_id),
      qualifiedInstructors,
      supersededRequestId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
