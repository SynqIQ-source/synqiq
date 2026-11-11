import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { searchMembers } from "@/lib/memberships/member-search";
import { frozenContracts } from "@/lib/memberships/freeze-check";
import { requireCheckoutApi } from "@/lib/pos/api";

// Checkout member picker: up to 8 matches, with whether each is on freeze
// (the screen then tells staff to unfreeze instead of selling a membership).
export async function GET(request: NextRequest) {
  const auth = await requireCheckoutApi();
  if ("error" in auth) return auth.error;
  const org = auth.currentStaff.organizationId;
  const admin = createSupabaseAdminClient();
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const matches = await searchMembers(admin as unknown as ScopedSupabaseClient, org, q, 8);
  const frozen = await frozenContracts(
    admin,
    org,
    matches.map((match) => match.mindbodyClientId),
  );
  const today = DateTime.now().toISODate()!;
  return NextResponse.json({
    success: true,
    members: matches.map((match) => ({
      id: match.mindbodyClientId,
      name: `${match.firstName} ${match.lastName}`.trim(),
      status: match.status,
      plans: match.contracts.filter((contract) => !contract.endDate || contract.endDate >= today).map((contract) => contract.contractName),
      frozen: frozen.some((row) => row.clientId === match.mindbodyClientId),
    })),
  });
}
