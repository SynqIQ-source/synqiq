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

// Manager-facing only: returns every response (interested and declined)
// with its status. Instructor-facing self-checks must use
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

    const interests = (interestRows ?? []).map((row) => {
      const staff = row.staff as unknown as {
        id: string;
        display_name: string;
        email: string | null;
      } | null;

      return {
        id: row.id,
        staffId: row.staff_id,
        status: row.status,
        respondedAt: row.responded_at,
        displayName: staff?.display_name ?? null,
        email: staff?.email ?? null,
      };
    });

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
