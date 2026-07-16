import { NextRequest, NextResponse } from "next/server";
import { respondToSubstitutionRequest } from "@/lib/substitutions/respond";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: requestId } = await params;
  const body = await request.json();
  const staffId: string | undefined = body?.staffId;

  if (!staffId) {
    return NextResponse.json({ error: "staffId is required." }, { status: 400 });
  }

  const result = await respondToSubstitutionRequest(requestId, staffId, "declined");

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
