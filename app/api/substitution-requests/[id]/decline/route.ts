import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { respondToSubstitutionRequest } from "@/lib/substitutions/respond";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: requestId } = await params;
  const body = await request.json();

  // A real session's identity always wins over whatever the client sent --
  // no session yet (the ~137 staff without a login) still trusts the body,
  // same as before.
  const currentStaff = await getCurrentStaff();
  const staffId: string | undefined = currentStaff?.id ?? body?.staffId;

  if (!staffId) {
    return NextResponse.json({ error: "staffId is required." }, { status: 400 });
  }

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
