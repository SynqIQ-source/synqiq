import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { validateAdjustment, type AdjustmentInput } from "@/lib/memberships/adjustments";

// Club Admins add a billing edit (dues credit, discount, freeze) to a member.
// Until the switch it only changes what shadow billing says SynqIQ would
// charge; Mindbody keeps charging as before. The row is its own audit record.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as (AdjustmentInput & { mindbodyClientId?: unknown }) | null;
  if (!body || typeof body.mindbodyClientId !== "string" || !body.mindbodyClientId.trim()) {
    return NextResponse.json({ success: false, error: "Unknown member." }, { status: 400 });
  }
  const mindbodyClientId = body.mindbodyClientId.trim();

  const supabase = await getScopedClient(currentStaff);
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle();
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;

  const result = validateAdjustment(body, today);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  const value = result.value;

  // The member (and the membership, if one was picked) must be this studio's.
  const { data: contracts, error: contractsError } = await supabase
    .from("member_contracts")
    .select("id")
    .eq("organization_id", currentStaff.organizationId)
    .eq("mindbody_client_id", mindbodyClientId);
  if (contractsError) {
    console.error("[billing-adjustments] contracts lookup failed:", contractsError.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  if (!contracts?.length) return NextResponse.json({ success: false, error: "This member has no memberships in SynqIQ." }, { status: 404 });
  if (value.contractId && !contracts.some((contract) => contract.id === value.contractId)) {
    return NextResponse.json({ success: false, error: "That membership isn't this member's." }, { status: 400 });
  }

  const { data: inserted, error } = await supabase
    .from("billing_adjustments")
    .insert({
      organization_id: currentStaff.organizationId,
      mindbody_client_id: mindbodyClientId,
      member_contract_id: value.contractId,
      kind: value.kind,
      amount_cents: value.amountCents,
      percent: value.percent,
      starts_on: value.startsOn,
      ends_on: value.endsOn,
      reason: value.reason,
      created_by_staff_id: currentStaff.id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[billing-adjustments] insert failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, id: inserted.id });
}
