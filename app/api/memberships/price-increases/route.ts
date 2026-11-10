import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { parseFilters, validateIncrease, type IncreaseInput } from "@/lib/memberships/price-increase";
import { loadCandidates, loadScheduledIncreases, previewIncrease } from "@/lib/memberships/price-increase-data";

// Club Admins schedule a bulk % price increase. The server re-runs the
// search (minus any memberships the admin unticked) so what's saved is
// exactly what the search covers now. Nothing is charged or emailed here:
// the notice is saved as a draft only.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as (IncreaseInput & { filters?: unknown; excludedContractIds?: unknown }) | null;
  if (!body) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });

  const supabase = await getScopedClient(currentStaff);
  const orgId = currentStaff.organizationId;
  const { data: org } = await supabase.from("organizations").select("timezone, billing_cutover_date").eq("id", orgId).maybeSingle();
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;
  const cutover = (org?.billing_cutover_date as string | undefined) ?? "2027-02-01";

  const filters = parseFilters(body.filters);
  if (!filters.ok) return NextResponse.json({ success: false, error: filters.error }, { status: 400 });
  const increase = validateIncrease(body, cutover, today);
  if (!increase.ok) return NextResponse.json({ success: false, error: increase.error }, { status: 400 });
  const excluded = new Set(
    Array.isArray(body.excludedContractIds) ? body.excludedContractIds.filter((id): id is string => typeof id === "string") : [],
  );

  let rows;
  try {
    const [candidates, scheduled] = await Promise.all([loadCandidates(supabase, orgId), loadScheduledIncreases(supabase, orgId)]);
    rows = previewIncrease(candidates, scheduled, filters.value, increase.value.percent, increase.value.roundToDollar, today).filter(
      (row) => !row.alreadyScheduled && !excluded.has(row.contractId),
    );
  } catch (error) {
    console.error("[price-increases] load failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Couldn't load memberships. Try again." }, { status: 500 });
  }
  if (!rows.length) return NextResponse.json({ success: false, error: "No memberships to increase." }, { status: 400 });

  const { data: saved, error } = await supabase
    .from("price_increases")
    .insert({
      organization_id: orgId,
      name: increase.value.name,
      percent: increase.value.percent,
      round_to_dollar: increase.value.roundToDollar,
      effective_on: increase.value.effectiveOn,
      filters: filters.value,
      notice_subject: increase.value.noticeSubject || null,
      notice_body: increase.value.noticeBody || null,
      member_count: new Set(rows.map((row) => row.mindbodyClientId)).size,
      created_by_staff_id: currentStaff.id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[price-increases] insert failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }

  for (let index = 0; index < rows.length; index += 500) {
    const { error: itemsError } = await supabase.from("price_increase_items").insert(
      rows.slice(index, index + 500).map((row) => ({
        organization_id: orgId,
        price_increase_id: saved.id,
        member_contract_id: row.contractId,
        mindbody_client_contract_id: row.mindbodyClientContractId,
        mindbody_client_id: row.mindbodyClientId,
        contract_name: row.contractName,
        original_start_date: row.originalStartDate ?? row.startDate,
        old_cents: row.normalAutopayCents as number,
        new_cents: row.newCents,
        tax_rate: row.taxRate === null || row.taxRate === undefined ? null : Math.round(row.taxRate * 1_000_000) / 1_000_000,
      })),
    );
    if (itemsError) {
      console.error("[price-increases] items insert failed:", itemsError.message);
      // Don't leave a half-saved increase looking scheduled.
      await supabase
        .from("price_increases")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by_staff_id: currentStaff.id,
          cancel_reason: "Save failed partway",
        })
        .eq("id", saved.id);
      return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    id: saved.id,
    memberships: rows.length,
  });
}
