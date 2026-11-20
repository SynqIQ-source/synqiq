import { NextRequest, NextResponse } from "next/server";
import { findStudio, getCurrentMember, sameOrigin } from "@/lib/member/session";
import { clientIp, sha256 } from "@/lib/crm/kiosk-auth";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { finishCardPayment } from "@/lib/payments/checkout";
import { cleanBuyerForm, quoteOnline, resolveBuyer, startOnlinePayment } from "@/lib/online/buy";
import type { AgreementSignatureRequest } from "@/lib/agreements/sale";

// Buy online / in the member app. The buyer is never taken from the browser:
// every step works it out again from the member's session, or from the
// name/email/phone they typed (matched to a guest or lead, or saved as a new
// lead). A past or current member must sign in.
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, error, ...extra }, { status });

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Not allowed.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const studio = await findStudio(Number(body?.studio));
  if (!studio || studio.mode === "off") return fail("Studio not found.", 404);
  const ip = clientIp(request.headers);
  if (!(await rateLimitAll([{ key: `buy:${sha256(ip ?? "none")}`, windowSeconds: 600, limit: 60 }])))
    return fail("Too many tries. Wait a few minutes and try again.", 429);

  if (body?.action === "finish") {
    const paymentId = typeof body.paymentId === "string" && UUID.test(body.paymentId) ? body.paymentId : null;
    if (!paymentId) return fail("Payment not found.");
    const result = await finishCardPayment(paymentId, studio.id);
    if ("error" in result) return fail(result.error, 400, { paid: result.paid ?? false });
    return NextResponse.json({ success: true, saleNumber: result.saleNumber, practice: !result.livemode });
  }

  const itemId = typeof body?.itemId === "string" && UUID.test(body.itemId) ? body.itemId : null;
  if (!itemId) return fail("Pick what you'd like to buy.");
  const billingStart = body?.billingStart === "prorated" ? ("prorated" as const) : ("signup" as const);

  const member = await getCurrentMember(studio);
  let who: Parameters<typeof resolveBuyer>[2];
  if (member) who = { member: { mindbodyClientId: member.mindbodyClientId, name: member.name } };
  else {
    const form = cleanBuyerForm(body?.buyer);
    if ("error" in form) return fail(form.error);
    who = { form };
  }
  const admin = createSupabaseAdminClient();
  const buyer = await resolveBuyer(admin, studio.id, who);
  if ("error" in buyer) return fail(buyer.error, 400, { signIn: buyer.signIn ?? false });

  if (body?.action === "quote") {
    const quote = await quoteOnline(studio.id, buyer, itemId, billingStart);
    if ("error" in quote) return fail(quote.error);
    return NextResponse.json({
      success: true,
      buyerName: buyer.clientName,
      totalCents: quote.totalCents,
      recurring: quote.recurring,
      agreements: quote.agreements.map((agreement) => ({
        lineIndex: agreement.lineIndex,
        title: agreement.title,
        body: agreement.body,
        sha256: agreement.sha256,
      })),
    });
  }

  if (body?.action === "pay") {
    const signerName = typeof body.signerName === "string" ? body.signerName.trim().slice(0, 120) : "";
    const signed = Array.isArray(body.agreements) ? body.agreements : [];
    const agreements: AgreementSignatureRequest[] = signed
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) => ({
        lineIndex: Number(row.lineIndex),
        sha256: String(row.sha256 ?? ""),
        signerName,
        method: "typed" as const,
        signature: null,
        agreed: row.agreed === true,
      }));
    const started = await startOnlinePayment(studio.id, buyer, itemId, billingStart, agreements, {
      ip,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
    if ("error" in started) return fail(started.error ?? "Couldn't start the payment. Try again.");
    return NextResponse.json({ success: true, ...started });
  }

  return fail("Unknown action.");
}
