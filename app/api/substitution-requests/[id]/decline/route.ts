import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { respondToSubstitutionRequest } from "@/lib/substitutions/respond";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id: requestId } = await params;

  // A real session is required, full stop -- this used to trust a
  // client-supplied staffId when no session existed.
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const staffId = currentStaff.id;

  const supabase = await getScopedClient(currentStaff);
  const result = await respondToSubstitutionRequest(supabase, requestId, staffId, "declined");

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
