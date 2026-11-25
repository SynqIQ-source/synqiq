import { NextRequest, NextResponse } from "next/server";
import { findConfirmLink, finishPaymentConfirm, startPaymentConfirm } from "@/lib/billing/confirm-payment";

// The emailed "confirm your payment" link (/pay/<token>): no sign-in; the
// token (7 days, once) says which member and which monthly payment. The
// bank's check (3D Secure) runs in Stripe's own window on the page.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const link = await findConfirmLink(String(body?.token ?? ""));
  if (!link) return NextResponse.json({ success: false, error: "This link has expired. Ask the front desk for a new one." }, { status: 404 });
  try {
    if (body?.action === "start") {
      const result = await startPaymentConfirm(link);
      if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      return NextResponse.json({ success: true, ...result });
    }
    if (body?.action === "finish") {
      const result = await finishPaymentConfirm(link, String(body.paymentIntentId ?? ""));
      if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      return NextResponse.json({ success: true, paid: true });
    }
  } catch (error) {
    console.error("[payment-confirm] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
