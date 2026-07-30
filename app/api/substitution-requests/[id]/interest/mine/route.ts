import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

type RouteParams = { params: Promise<{ id: string }> };

// Instructor-facing self-check: returns only whether/how the *calling*
// staff member has responded ('interested' | 'declined' | null for no
// response yet) -- nothing about any other candidate. Full candidate
// visibility belongs to the manager-facing GET
// /api/substitution-requests/:id/interest, not here.
//
// A real session is required, full stop -- this used to accept a
// client-supplied ?staffId= with no session check at all, letting anyone
// who knew a request id + staff id read that staff member's private
// response. staffId is now always derived from the session, never trusted
// from the request.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const { id: requestId } = await params;
    const supabase = await getScopedClient(currentStaff);

    const { data: substitutionRequest, error: requestError } = await supabase
      .from("substitution_requests")
      .select("id")
      .eq("id", requestId)
      .single();

    if (requestError || !substitutionRequest) {
      return NextResponse.json(
        { error: "Substitution request not found." },
        { status: 404 },
      );
    }

    const { data: interest, error: interestError } = await supabase
      .from("substitution_interests")
      .select("status, responded_at")
      .eq("request_id", requestId)
      .eq("staff_id", currentStaff.id)
      .maybeSingle();

    if (interestError) {
      throw new Error(interestError.message);
    }

    return NextResponse.json({
      success: true,
      status: interest?.status ?? null,
      respondedAt: interest?.responded_at ?? null,
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
