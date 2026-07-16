import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

// Instructor-facing self-check: returns only whether/how the given staff
// member has responded ('interested' | 'declined' | null for no response
// yet) -- nothing about any other candidate. Full candidate visibility
// belongs to the manager-facing GET /api/substitution-requests/:id/interest,
// not here.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;
    const staffId = request.nextUrl.searchParams.get("staffId");

    if (!staffId) {
      return NextResponse.json({ error: "staffId is required." }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();

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
      .eq("staff_id", staffId)
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
