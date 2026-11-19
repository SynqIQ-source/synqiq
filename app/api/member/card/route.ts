import { NextRequest, NextResponse } from "next/server";
import { findStudio, getCurrentMember, sameOrigin } from "@/lib/member/session";
import { finishCardUpdate, startCardUpdate } from "@/lib/billing/cards";

// A signed-in member updates their own card in the app. The card goes from
// the app straight to Stripe (the studio's account); SynqIQ keeps only which
// card it is.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const studio = await findStudio(Number(body?.studio));
  if (!studio) return NextResponse.json({ success: false, error: "Studio not found." }, { status: 404 });
  const member = await getCurrentMember(studio);
  if (!member) return NextResponse.json({ success: false, error: "Sign in to update your card.", signIn: true }, { status: 401 });

  if (body?.action === "start") {
    const result = await startCardUpdate(studio.id, member.mindbodyClientId, "app", null);
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  if (body?.action === "finish") {
    const result = await finishCardUpdate(String(body.setupIntentId ?? ""), {
      organizationId: studio.id,
      clientId: member.mindbodyClientId,
    });
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
