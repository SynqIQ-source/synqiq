import { NextRequest, NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { withRetry } from "@/lib/retry";
import { asOccurrenceId } from "@/lib/mindbody/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;
    const body = await request.json();
    const staffId: string | undefined = body?.staffId;

    if (!staffId) {
      return NextResponse.json({ error: "staffId is required." }, { status: 400 });
    }

    // Admin-only action, no dropdown fallback: unlike every other route in
    // this migration, a session-less caller is refused outright here rather
    // than falling back to the admin client. This route previously had zero
    // caller-role verification at all -- any request, from anyone, could
    // approve any candidate for any request. That's the gap this closes.
    const currentStaff = await getCurrentStaff();
    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { error: "Only an authenticated admin can approve a substitute." },
        { status: 403 },
      );
    }

    const supabase = await getScopedClient(currentStaff);

    const { data: substitutionRequest, error: requestError } = await supabase
      .from("substitution_requests")
      .select("id, status, occurrence_id, requested_by")
      .eq("id", requestId)
      .single();

    if (requestError || !substitutionRequest) {
      return NextResponse.json(
        { error: "Substitution request not found." },
        { status: 404 },
      );
    }

    // Fast-path only -- a plain read, not a lock, so it can't by itself
    // prevent two concurrent selections (or a select racing a cancel) from
    // both passing this check before either has written anything. It just
    // avoids wasted work in the common (non-racing) case; the actual
    // concurrency guard is the claim step below, right before the MindBody
    // call. Confirmed empirically: without that guard, two concurrent
    // selects for different candidates both report success, and whichever
    // DB write commits last silently wins with no error to the loser --
    // see conversation history.
    if (substitutionRequest.status !== "open") {
      return NextResponse.json(
        { error: `This request is no longer open (status: ${substitutionRequest.status}).` },
        { status: 409 },
      );
    }

    const { data: interestRow, error: interestError } = await supabase
      .from("substitution_interests")
      .select("status")
      .eq("request_id", requestId)
      .eq("staff_id", staffId)
      .maybeSingle();

    if (interestError) {
      throw new Error(interestError.message);
    }

    if (!interestRow) {
      return NextResponse.json(
        { error: "This staff member has not responded to this request." },
        { status: 404 },
      );
    }

    if (interestRow.status !== "interested") {
      return NextResponse.json(
        { error: `This staff member's response was '${interestRow.status}', not 'interested' -- cannot select them.` },
        { status: 409 },
      );
    }

    const { data: occurrence, error: occurrenceError } = await supabase
      .from("class_occurrences")
      .select("mindbody_occurrence_id, organization_id, class_name")
      .eq("id", substitutionRequest.occurrence_id)
      .single();

    if (occurrenceError || !occurrence || occurrence.mindbody_occurrence_id === null) {
      return NextResponse.json(
        { error: "This request's class occurrence has no MindBody occurrence id -- cannot substitute." },
        { status: 409 },
      );
    }

    const { data: chosenStaff, error: staffError } = await supabase
      .from("staff")
      .select("mindbody_staff_id")
      .eq("id", staffId)
      .single();

    if (staffError || !chosenStaff || chosenStaff.mindbody_staff_id === null) {
      return NextResponse.json(
        { error: "The chosen staff member has no MindBody staff id -- cannot substitute." },
        { status: 409 },
      );
    }

    // The actual concurrency guard: atomically claim this request before
    // touching MindBody at all. A plain UPDATE with a WHERE status = 'open'
    // condition is fully atomic w.r.t. other concurrent writers to the same
    // row -- Postgres serializes concurrent UPDATEs to one row, so a second
    // writer's WHERE clause re-evaluates against whatever the first writer
    // already committed. If this affects 0 rows, someone else (another
    // select, or a cancel) already resolved this request -- return before
    // ever calling MindBody, rather than after, so a losing request never
    // fires a real external write. pending_selection is an existing,
    // previously-unused value in the status CHECK constraint -- reused here
    // as exactly the "someone is in the process of resolving this" state.
    const { data: claimedRows, error: claimError } = await supabase
      .from("substitution_requests")
      .update({ status: "pending_selection" })
      .eq("id", requestId)
      .eq("status", "open")
      .select("id");

    if (claimError) {
      throw new Error(claimError.message);
    }

    if (!claimedRows || claimedRows.length === 0) {
      return NextResponse.json(
        { error: "This request was just resolved by someone else -- refresh and try again." },
        { status: 409 },
      );
    }

    // Call MindBody FIRST. Our own DB is only ever finalized after this
    // succeeds -- if it fails, revert the claim back to 'open' so the
    // request isn't stuck in limbo, and the manager can retry the same or a
    // different candidate with no other cleanup needed.
    const mindbody = createMindbodyClient();
    const { AccessToken: accessToken } = await mindbody.authenticate();

    try {
      await mindbody.substituteClassTeacher(
        asOccurrenceId(occurrence.mindbody_occurrence_id),
        chosenStaff.mindbody_staff_id,
        accessToken,
      );
    } catch (mindbodyError) {
      await supabase
        .from("substitution_requests")
        .update({ status: "open" })
        .eq("id", requestId)
        .eq("status", "pending_selection");

      return NextResponse.json(
        {
          error: "MindBody rejected the substitution -- no changes were made to our records.",
          details: mindbodyError instanceof Error ? mindbodyError.message : "Unknown error",
        },
        { status: 502 },
      );
    }

    // MindBody succeeded -- the real-world schedule is already changed at
    // this point. Retry our own DB update a few times to close the window
    // where MindBody is right but we don't know it yet; if it still fails,
    // say so explicitly rather than returning a generic error that looks
    // like nothing happened.
    try {
      await withRetry(async () => {
        const { data: finalizedRows, error: updateRequestError } = await supabase
          .from("substitution_requests")
          .update({ status: "approved", resolved_at: new Date().toISOString() })
          .eq("id", requestId)
          .eq("status", "pending_selection")
          .select("id");

        if (updateRequestError) {
          throw new Error(updateRequestError.message);
        }

        if (!finalizedRows || finalizedRows.length === 0) {
          // Should be unreachable -- nothing else can move a row out of
          // pending_selection once this request claimed it. Surfaced as a
          // retriable error rather than silently swallowed, same as any
          // other unexpected write failure in this block.
          throw new Error(
            "Expected this request to still be pending_selection after the claim, but it wasn't.",
          );
        }

        const { error: updateOccurrenceError } = await supabase
          .from("class_occurrences")
          .update({ substitute_staff_id: staffId })
          .eq("id", substitutionRequest.occurrence_id);

        if (updateOccurrenceError) {
          throw new Error(updateOccurrenceError.message);
        }
      });
    } catch (dbError) {
      return NextResponse.json(
        {
          error:
            "MindBody was updated but our records failed to sync -- the class's instructor has genuinely changed in MindBody, but our database doesn't reflect it yet. Needs manual reconciliation or a re-sync.",
          mindbodySucceeded: true,
          dbUpdateFailed: true,
          details: dbError instanceof Error ? dbError.message : "Unknown error",
        },
        { status: 500 },
      );
    }

    // Non-critical, best-effort: a sub-specific chat board for the
    // requester + covering instructor. Approval has already fully
    // succeeded above -- MindBody and our own records are both updated --
    // so a board-creation failure here must never fail this response or
    // imply the approval itself is in doubt. Logged loudly rather than
    // swallowed, since this is the only place that would ever notice a
    // repeated failure (e.g. a broken RLS policy after a future change).
    try {
      const { data: board, error: boardError } = await supabase
        .from("message_boards")
        .insert({
          organization_id: occurrence.organization_id,
          board_type: "sub_specific",
          title: `Coverage: ${occurrence.class_name ?? "class"}`,
          substitution_request_id: requestId,
        })
        .select("id")
        .single();

      if (boardError || !board) {
        throw new Error(boardError?.message ?? "Failed to create sub-specific board.");
      }

      const memberStaffIds = [...new Set([substitutionRequest.requested_by, staffId])];
      const { error: membersError } = await supabase
        .from("board_members")
        .insert(memberStaffIds.map((memberStaffId) => ({ board_id: board.id, staff_id: memberStaffId })));

      if (membersError) {
        throw new Error(membersError.message);
      }
    } catch (boardError) {
      console.error(
        `[select/route] Failed to create sub-specific message board for substitution_request ${requestId}:`,
        boardError instanceof Error ? boardError.message : boardError,
      );
    }

    return NextResponse.json({
      success: true,
      requestId,
      occurrenceId: substitutionRequest.occurrence_id,
      selectedStaffId: staffId,
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
