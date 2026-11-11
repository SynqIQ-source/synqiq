import { NextRequest, NextResponse } from "next/server";
import { endSession, sameOrigin } from "@/lib/member/session";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const response = NextResponse.json({ success: true });
  await endSession(request, response);
  return response;
}
