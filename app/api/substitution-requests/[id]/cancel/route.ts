import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;
    const body = await request.json();
    const callerStaffId: string | undefined = body?.callerStaffId;

    if (!callerStaffId) {
      return NextResponse.json(
        { error: "callerStaffId is required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();

    const { data: substitutionRequest, error: requestError } = await supabase
      .from("substitution_requests")
      .select("id, status, requested_by")
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
        { error: `This request is no longer open (status: ${substitutionRequest.status}) -- cannot cancel.` },
        { status: 409 },
      );
    }

    // TODO: no auth/session system exists yet, so this is a plain equality
    // check against a client-supplied callerStaffId, not a verified identity
    // -- same caveat as requestedBy elsewhere in this file's sibling routes.
    // Once real auth/roles exist, this should become "requester OR admin",
    // not just requester -- there is no admin concept in the data model at
    // all today, so that half can't be implemented yet.
    if (callerStaffId !== substitutionRequest.requested_by) {
      return NextResponse.json(
        { error: "Only the original requester can cancel this request." },
        { status: 403 },
      );
    }

    const { error: updateError } = await supabase
      .from("substitution_requests")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", requestId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      success: true,
      requestId,
      status: "cancelled",
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
