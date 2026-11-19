import { NextRequest, NextResponse } from "next/server";
import { unsubscribe } from "@/lib/email/newsletters";

// Unsubscribe from a studio's newsletters. Mail apps call this directly
// (List-Unsubscribe-Post one-click); the /u/[token] page's button posts here
// too and is sent back to the page.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = await unsubscribe(token);
  const fromPage = request.nextUrl.searchParams.get("page") === "1";
  if (fromPage) return NextResponse.redirect(new URL(`/u/${encodeURIComponent(token)}?done=${ok ? 1 : 0}`, request.url), 303);
  return NextResponse.json({ success: ok }, { status: ok ? 200 : 404 });
}
