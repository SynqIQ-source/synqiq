import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCheckoutApi } from "@/lib/pos/api";
import { findPromo, savePracticeSale, type SaleLineRequest } from "@/lib/pos/sales";

// Checkout. POST { action: "promo", code } checks a code;
// POST { action: "sale", clientId?, clientName?, lines[], promoCode?, note? }
// saves a PRACTICE sale (no money moves until payments are connected).
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

  if (body.action === "sale") {
    const lines = (Array.isArray(body.lines) ? body.lines : []) as SaleLineRequest[];
    const clean = lines.map((line) => ({
      itemId: String(line.itemId ?? ""),
      quantity: Number(line.quantity ?? 1),
      discount:
        line.discount && (line.discount.kind === "percent" || line.discount.kind === "amount") && Number(line.discount.value) > 0
          ? { kind: line.discount.kind, value: Number(line.discount.value) }
          : null,
      credits: Array.isArray(line.credits)
        ? line.credits.map((credit) => ({ staffId: String(credit.staffId ?? ""), share: Number(credit.share ?? 100) }))
        : [],
      none: line.none === true,
    }));
    const result = await savePracticeSale(currentStaff, {
      clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
      clientName: typeof body.clientName === "string" && body.clientName ? body.clientName : null,
      lines: clean,
      promoCode: typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode : null,
      note: typeof body.note === "string" && body.note.trim() ? body.note : null,
    });
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
