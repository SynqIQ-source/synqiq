import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { respondToSubstitutionRequest } from "@/lib/substitutions/respond";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: requestId } = await params;
  const body = await request.json();
  const staffId: string | undefined = body?.staffId;

  if (!staffId) {
    return NextResponse.json({ error: "staffId is required." }, { status: 400 });
  }

  const result = await respondToSubstitutionRequest(requestId, staffId, "interested");

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, existingStatus: result.existingStatus },
      { status: result.httpStatus },
    );
  }

  return NextResponse.json({
    success: true,
    interest: result.interest,
    alreadyResponded: result.alreadyResponded,
  });
}

// Ranks in the order a manager should scan them: instructors who said yes
// first, then everyone still pending, then declines last.
const STATUS_RANK: Record<string, number> = {
  interested: 0,
  no_response: 1,
  declined: 2,
};

type CandidateEntry = {
  id: string | null;
  staffId: string;
  status: "interested" | "declined" | "no_response";
  respondedAt: string | null;
  displayName: string | null;
  email: string | null;
};

// Manager-facing only: returns every response (interested and declined),
// plus every other qualified instructor who hasn't responded at all (status
// "no_response", synthesized here -- there's no substitution_interests row
// for them to read). Without this, a manager can't tell "no one is
// available" (everyone declined or never got asked) apart from "no one has
// answered yet" (still pending). Instructor-facing self-checks must use
// GET /api/substitution-requests/:id/interest/mine instead, which only
// reveals the calling staff member's own response -- never the full list.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;
    const supabase = createSupabaseAdminClient();

    const { data: substitutionRequest, error: requestError } = await supabase
      .from("substitution_requests")
      .select("id, status, occurrence_id, requested_by, reason, created_at, resolved_at")
      .eq("id", requestId)
      .single();

    if (requestError || !substitutionRequest) {
      return NextResponse.json(
        { error: "Substitution request not found." },
        { status: 404 },
      );
    }

    const { data: interestRows, error: interestsError } = await supabase
      .from("substitution_interests")
      .select(
        "id, staff_id, status, responded_at, staff:staff!substitution_interests_staff_id_fkey ( id, display_name, email )",
      )
      .eq("request_id", requestId)
      .order("responded_at", { ascending: true });

    if (interestsError) {
      throw new Error(interestsError.message);
    }

    const interests: CandidateEntry[] = (interestRows ?? []).map((row) => {
      const staff = row.staff as unknown as {
        id: string;
        display_name: string;
        email: string | null;
      } | null;

      return {
        id: row.id,
        staffId: row.staff_id,
        status: row.status as "interested" | "declined",
        respondedAt: row.responded_at as string | null,
        displayName: staff?.display_name ?? null,
        email: staff?.email ?? null,
      };
    });

    // Same eligibility rule as request creation
    // (app/api/substitution-requests/route.ts): a row in
    // instructor_class_eligibility for this occurrence's (department, class
    // name) combo, enabled=true, excluding the instructor currently assigned
    // to the occurrence (they aren't a candidate to cover themselves).
    const { data: occurrence, error: occurrenceError } = await supabase
      .from("class_occurrences")
      .select("department_id, class_name, staff_id")
      .eq("id", substitutionRequest.occurrence_id)
      .single();

    if (occurrenceError || !occurrence) {
      throw new Error(occurrenceError?.message ?? "Occurrence not found.");
    }

    const respondedStaffIds = new Set(interests.map((interest) => interest.staffId));

    if (occurrence.department_id && occurrence.class_name) {
      let eligibilityQuery = supabase
        .from("instructor_class_eligibility")
        .select(
          "staff:staff!instructor_class_eligibility_staff_id_fkey ( id, display_name, email )",
        )
        .eq("department_id", occurrence.department_id)
        .eq("class_name", occurrence.class_name.trim())
        .eq("enabled", true);

      if (occurrence.staff_id) {
        eligibilityQuery = eligibilityQuery.neq("staff_id", occurrence.staff_id);
      }

      const { data: eligibilityRows, error: eligibilityError } = await eligibilityQuery;

      if (eligibilityError) {
        throw new Error(eligibilityError.message);
      }

      for (const row of eligibilityRows ?? []) {
        const staff = row.staff as unknown as {
          id: string;
          display_name: string;
          email: string | null;
        } | null;

        if (!staff || respondedStaffIds.has(staff.id)) {
          continue;
        }

        interests.push({
          id: null,
          staffId: staff.id,
          status: "no_response",
          respondedAt: null,
          displayName: staff.display_name,
          email: staff.email,
        });
      }
    }

    interests.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

    return NextResponse.json({
      success: true,
      request: substitutionRequest,
      interests,
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
