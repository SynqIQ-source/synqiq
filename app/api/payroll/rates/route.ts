import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents, fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";
import { rateProblem } from "@/lib/payroll/rates";

// Create, edit or archive a pay rate template (Club Admin).
// Body: { id?, name, appliesTo, method, base, perHead, headsAbove, cap, percent, flat } in dollars,
// or { id, archive: true }.
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();
  const id = isUuid(body.id) ? body.id : null;

  if (body.archive === true) {
    if (!id) return fail("Pick a rate.");
    const [{ count: defaults }, { count: overrides }] = await Promise.all([
      admin
        .from("staff_pay_settings")
        .select("staff_id", { count: "exact", head: true })
        .eq("organization_id", currentStaff.organizationId)
        .or(`class_rate_id.eq.${id},appointment_rate_id.eq.${id}`),
      admin
        .from("staff_pay_assignments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", currentStaff.organizationId)
        .eq("pay_rate_id", id),
    ]);
    if ((defaults ?? 0) + (overrides ?? 0) > 0) return fail("Someone is still paid on this rate. Move them to another rate first.");
    const { error } = await admin
      .from("pay_rates")
      .update({ archived_at: new Date().toISOString(), updated_by_staff_id: currentStaff.id })
      .eq("id", id)
      .eq("organization_id", currentStaff.organizationId);
    if (error) return fail("Couldn't save. Try again.", 500);
    return NextResponse.json({ success: true });
  }

  const method = String(body.method ?? "");
  const input = {
    name: String(body.name ?? "").trim(),
    appliesTo: String(body.appliesTo ?? ""),
    method,
    baseCents: method === "class_formula" ? (dollarsToCents(body.base) ?? 0) : 0,
    perHeadCents: method === "class_formula" ? (dollarsToCents(body.perHead) ?? 0) : 0,
    headsAbove: method === "class_formula" ? Number(body.headsAbove ?? 0) : 0,
    capCents: method === "class_formula" ? dollarsToCents(body.cap) : null,
    percent: method === "percent" ? Number(body.percent) : null,
    flatCents: method === "flat" ? dollarsToCents(body.flat) : null,
  };
  const problem = rateProblem(input);
  if (problem) return fail(problem);
  const noRegistrationCents = input.appliesTo === "class" ? dollarsToCents(body.noRegistration) : null;
  if (Number.isNaN(noRegistrationCents) || (noRegistrationCents != null && (noRegistrationCents < 0 || noRegistrationCents > 1_000_000)))
    return fail("Enter the no-registrations amount in dollars, or leave it blank.");
  const row = {
    organization_id: currentStaff.organizationId,
    name: input.name,
    applies_to: input.appliesTo,
    method: input.method,
    base_cents: input.baseCents,
    per_head_cents: input.perHeadCents,
    heads_above: input.headsAbove,
    cap_cents: input.capCents,
    percent: input.percent,
    flat_cents: input.flatCents,
    no_registration_cents: noRegistrationCents,
    updated_at: new Date().toISOString(),
    updated_by_staff_id: currentStaff.id,
  };
  const { error } = id
    ? await admin.from("pay_rates").update(row).eq("id", id).eq("organization_id", currentStaff.organizationId)
    : await admin.from("pay_rates").insert(row);
  if (error) {
    if (error.code === "23505") return fail("There's already a rate with that name.");
    console.error("[payroll] rate save failed:", error.message);
    return fail("Couldn't save. Try again.", 500);
  }
  return NextResponse.json({ success: true });
}
