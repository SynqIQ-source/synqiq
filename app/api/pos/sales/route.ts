import { sendToReader } from "@/lib/payments/terminal";
import { removeSoldPacks } from "@/lib/sessions/packs";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCheckoutApi } from "@/lib/pos/api";
import { refundRenewalSale } from "@/lib/billing/refunds";
import { canVoidSale, findPromo, savePracticeSale, type SaleLineRequest } from "@/lib/pos/sales";
import { chargeCardOnFile, finishCardPayment, refundCardSale, startCardPayment } from "@/lib/payments/checkout";

// Checkout. POST { action: "promo", code } checks a code;
// POST { action: "sale", clientId?, clientName?, lines[], promoCode?, note?, agreements? }
// saves a PRACTICE sale (no money moves until payments are connected);
// POST { action: "agreements", ...same } checks the sale and returns the
// agreements the buyer must sign first;
// POST { action: "card_start", ...same as sale } checks the sale and starts a
// card payment in the studio's Stripe account (returns the client secret);
// POST { action: "card_finish", paymentId } saves the sale once Stripe has
// confirmed the payment; POST { action: "void" } refunds a card sale.
export async function POST(request: NextRequest) {
  const auth = await requireCheckoutApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });

  if (body.action === "promo") {
    const admin = createSupabaseAdminClient();
    const { data: org } = await admin.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle();
    const { promo, error } = await findPromo(
      admin,
      currentStaff.organizationId,
      String(body.code ?? ""),
      (org?.timezone as string | null) ?? "America/Chicago",
    );
    if (!promo) return NextResponse.json({ success: false, error: error ?? "Enter a code." }, { status: 400 });
    return NextResponse.json({ success: true, promo });
  }

  if (body.action === "card_finish") {
    const paymentId = typeof body.paymentId === "string" && /^[0-9a-f-]{36}$/i.test(body.paymentId) ? body.paymentId : "";
    if (!paymentId) return NextResponse.json({ success: false, error: "Payment not found." }, { status: 400 });
    const result = await finishCardPayment(paymentId, currentStaff.organizationId);
    if ("error" in result) return NextResponse.json({ success: false, ...result }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }

  if (body.action === "sale" || body.action === "agreements" || body.action === "card_start" || body.action === "card_on_file") {
    const lines = (Array.isArray(body.lines) ? body.lines : []) as SaleLineRequest[];
    const clean = lines.map((line) => ({
      itemId: String(line.itemId ?? ""),
      quantity: Number(line.quantity ?? 1),
      priceCents: line.priceCents == null ? null : Math.round(Number(line.priceCents)),
      discount:
        line.discount && (line.discount.kind === "percent" || line.discount.kind === "amount") && Number(line.discount.value) > 0
          ? { kind: line.discount.kind, value: Number(line.discount.value) }
          : null,
      credits: Array.isArray(line.credits)
        ? line.credits.map((credit) => ({ staffId: String(credit.staffId ?? ""), share: Number(credit.share ?? 100) }))
        : [],
      none: line.none === true,
    }));
    const saleRequest = {
      clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
      clientName: typeof body.clientName === "string" && body.clientName ? body.clientName : null,
      lines: clean,
      promoCode: typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode : null,
      note: typeof body.note === "string" && body.note.trim() ? body.note : null,
      billingStart: body.billingStart === "prorated" ? ("prorated" as const) : ("signup" as const),
      agreements: (Array.isArray(body.agreements) ? body.agreements : []).slice(0, 100).map((raw: Record<string, unknown>) => ({
        lineIndex: Number(raw?.lineIndex),
        sha256: String(raw?.sha256 ?? ""),
        signerName: String(raw?.signerName ?? "").slice(0, 200),
        method: raw?.method === "typed" ? ("typed" as const) : ("drawn" as const),
        signature: typeof raw?.signature === "string" ? raw.signature : null,
        agreed: raw?.agreed === true,
      })),
      evidence: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip"),
        userAgent: request.headers.get("user-agent"),
      },
    };
    if (body.action === "card_on_file") {
      const result = await chargeCardOnFile(currentStaff, saleRequest, body.useDuesCard === true);
      if ("needsDuesConfirm" in result) return NextResponse.json({ success: false, needsDuesConfirm: result.needsDuesConfirm });
      if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      return NextResponse.json({ success: true, ...result });
    }
    if (body.action === "card_start") {
      // readerId: the card is tapped / inserted on that desk reader.
      const readerId = typeof body.readerId === "string" && /^[0-9a-f-]{36}$/i.test(body.readerId) ? body.readerId : null;
      const started = await startCardPayment(currentStaff, saleRequest, { terminal: Boolean(readerId) });
      if ("error" in started) return NextResponse.json({ success: false, error: started.error }, { status: 400 });
      if (readerId) {
        const sent = await sendToReader(currentStaff.organizationId, started.paymentId, readerId);
        if ("error" in sent) return NextResponse.json({ success: false, error: sent.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, ...started });
    }
    const result = await savePracticeSale(currentStaff, { ...saleRequest, dryRun: body.action === "agreements" });
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  if (body.action === "void") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (!reason) return NextResponse.json({ success: false, error: "Add a reason." }, { status: 400 });
    const saleId = typeof body.saleId === "string" ? body.saleId : "";
    const admin = createSupabaseAdminClient();
    const { data: sale } = await admin
      .from("pos_sales")
      .select("id, staff_id, status, created_at, source")
      .eq("id", saleId)
      .eq("organization_id", currentStaff.organizationId)
      .maybeSingle();
    if (!sale) return NextResponse.json({ success: false, error: "Sale not found." }, { status: 404 });
    if (sale.status === "voided") return NextResponse.json({ success: false, error: "Already voided." }, { status: 400 });
    // Automatic renewals (no staff member) can be voided by Club Admins and Sales Leads.
    if (!canVoidSale(currentStaff, { staffId: (sale.staff_id as string | null) ?? "", createdAt: sale.created_at as string }, new Date()))
      return NextResponse.json({ success: false, error: "Only a Club Admin or Sales Lead can void this sale." }, { status: 403 });
    // A card sale is refunded to the card first; if Stripe can't, it stays.
    // Renewals refund through their renewal charge; desk and online sales
    // through their card payment (online sales have no staff member either).
    const isRenewal = sale.source === "renewal";
    const refund = isRenewal
      ? await refundRenewalSale(admin, currentStaff.organizationId, saleId)
      : await refundCardSale(admin, currentStaff.organizationId, saleId);
    if ("error" in refund) return NextResponse.json({ success: false, error: refund.error }, { status: 502 });
    const { error } = await admin
      .from("pos_sales")
      .update({ status: "voided", voided_at: new Date().toISOString(), voided_by_staff_id: currentStaff.id, void_reason: reason })
      .eq("id", saleId);
    if (error) return NextResponse.json({ success: false, error: "Couldn't void. Try again." }, { status: 500 });
    // A voided sale's membership payment schedule is voided with it (a voided
    // renewal refunds that month only; the schedule carries on).
    if (!isRenewal)
      await admin
        .from("member_billing_schedules")
        .update({ status: "voided", voided_at: new Date().toISOString() })
        .eq("sale_id", saleId)
        .eq("organization_id", currentStaff.organizationId);
    // Session packs it sold go too, unless sessions were already used.
    const packs = await removeSoldPacks(admin, currentStaff.organizationId, saleId);
    return NextResponse.json({
      success: true,
      ...(packs.kept ? { warning: `${packs.kept} session pack(s) were already used and stay on the account.` } : {}),
    });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
