import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;
    const body = await request.json();

    // A real session's identity always wins over whatever the client sent.
    // No session yet still trusts the body, same as before.
    const currentStaff = await getCurrentStaff();
    const callerStaffId: string | undefined = currentStaff?.id ?? body?.callerStaffId;

    if (!callerStaffId) {
      return NextResponse.json(
        { error: "callerStaffId is required." },
        { status: 400 },
      );
    }

    const supabase = await getScopedClient(currentStaff);

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

    // callerStaffId is trustworthy now when a real session exists (derived
    // above, not read from the body), but this check stays regardless of
    // which client is in use -- substitution_requests_update_own would
    // reject a mismatched UPDATE too, but Postgres RLS makes a non-matching
    // UPDATE affect zero rows silently rather than error, and nothing below
    // checks the affected row count. This is still the real gate. TODO:
    // could become "requester OR admin" now that real roles exist
    // (substitution_requests_update_admin already supports it at the DB
    // layer) -- not changed here since it's a scope decision, not a
    // mechanical migration.
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
