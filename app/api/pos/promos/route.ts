import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents, fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";

// Promo codes (Club Admin only). { id?, code, kind: percent|amount, percent, amount (dollars),
// categoryIds[] (empty = everything), startsOn, endsOn, maxUses, note } or { id, deactivate: true }.
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const org = currentStaff.organizationId;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();

  if (body.deactivate === true) {
    if (!isUuid(body.id)) return fail("Pick a code.");
    const { error } = await admin.from("promo_codes").update({ active: false }).eq("id", body.id).eq("organization_id", org);
    return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
  }

  const code = String(body.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return fail("Codes are 2-30 letters or numbers (no spaces).");
  const kind = body.kind === "amount" ? "amount" : "percent";
  const percent = kind === "percent" ? Number(body.percent) : null;
  const amountCents = kind === "amount" ? dollarsToCents(body.amount) : null;
  if (kind === "percent" && !(percent! > 0 && percent! <= 100)) return fail("Enter a percent off between 1 and 100.");
  if (kind === "amount" && !(amountCents && amountCents > 0)) return fail("Enter the dollars off.");
  const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const maxUses = body.maxUses === "" || body.maxUses == null ? null : Number(body.maxUses);
  if (maxUses != null && !(Number.isInteger(maxUses) && maxUses > 0)) return fail("Uses must be a whole number.");
  const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.filter(isUuid) : [];
  const { error } = await admin.from("promo_codes").insert({
    organization_id: org,
    code,
    kind,
    percent,
    amount_cents: amountCents,
    revenue_category_ids: categoryIds.length ? categoryIds : null,
    starts_on: day(body.startsOn),
    ends_on: day(body.endsOn),
    max_uses: maxUses,
    note: typeof body.note === "string" ? body.note.slice(0, 200) : null,
    created_by_staff_id: currentStaff.id,
  });
  if (error)
    return fail(
      error.code === "23505" ? "There's already an active code with that name." : "Couldn't save. Try again.",
      error.code === "23505" ? 400 : 500,
    );
  return NextResponse.json({ success: true });
}
