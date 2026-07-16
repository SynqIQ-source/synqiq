import { NextRequest, NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

    const supabase = createSupabaseAdminClient();

    const { data: substitutionRequest, error: requestError } = await supabase
      .from("substitution_requests")
      .select("id, status, occurrence_id")
      .eq("id", requestId)
      .single();

    if (requestError || !substitutionRequest) {
      return NextResponse.json(
        { error: "Substitution request not found." },
        { status: 404 },
      );
    }

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
      .select("mindbody_occurrence_id")
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

    // Call MindBody FIRST. Our own DB is only ever updated after this
    // succeeds -- if it fails, nothing below runs, and substitution_requests
    // stays exactly 'open' so the manager can retry the same or a different
    // candidate with no cleanup needed.
    const mindbody = createMindbodyClient();
    const { AccessToken: accessToken } = await mindbody.authenticate();

    try {
      await mindbody.substituteClassTeacher(
        asOccurrenceId(occurrence.mindbody_occurrence_id),
        chosenStaff.mindbody_staff_id,
        accessToken,
      );
    } catch (mindbodyError) {
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
        const { error: updateRequestError } = await supabase
          .from("substitution_requests")
          .update({ status: "approved", resolved_at: new Date().toISOString() })
          .eq("id", requestId);

        if (updateRequestError) {
          throw new Error(updateRequestError.message);
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
