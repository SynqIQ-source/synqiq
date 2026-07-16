import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Non-terminal statuses -- an occurrence can't have two active requests at
// once (guards against double-submission), but can have a new one after a
// prior request reached a terminal state (completed/cancelled).
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
    // TODO: no auth/session system exists yet, so requestedBy is taken as a
    // plain client-supplied field with no verification. Revisit once staff
    // login exists -- MindBody's /usertoken/issue was investigated as a way
    // to delegate identity, but its User.Id is a session-scoped artifact of
    // the calling API credential, not a stable Staff.Id (confirmed: two
    // calls with the identical site-owner credential returned different
    // User.Id values, neither of which exists anywhere in the real 137-row
    // staff roster). A real instructor-level credential would need to be
    // tested before that approach could work.
    const requestedBy: string | undefined = body?.requestedBy;
    const reason: string | undefined = body?.reason;

    if (!occurrenceId || !requestedBy) {
      return NextResponse.json(
        { error: "occurrenceId and requestedBy are required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();

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
      .select("id, status")
      .eq("occurrence_id", occurrenceId)
      .in("status", NON_TERMINAL_STATUSES)
      .maybeSingle();

    if (existingRequestError) {
      throw new Error(existingRequestError.message);
    }

    if (existingRequest) {
      return NextResponse.json(
        {
          error: "An active substitution request already exists for this occurrence.",
          existingRequestId: existingRequest.id,
          existingStatus: existingRequest.status,
        },
        { status: 409 },
      );
    }

    const { data: substitutionRequest, error: insertError } = await supabase
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

    if (insertError || !substitutionRequest) {
      throw new Error(insertError?.message ?? "Failed to create substitution request.");
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
