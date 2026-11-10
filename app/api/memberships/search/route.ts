import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { searchMembers } from "@/lib/memberships/member-search";

// Autocomplete for the Memberships search (Club Admins): up to 8 members.
export async function GET(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const supabase = await getScopedClient(currentStaff);
  const today = DateTime.now().toISODate()!;
  const matches = await searchMembers(supabase, currentStaff.organizationId, q, 8);
  return NextResponse.json({
    success: true,
    members: matches.map((match) => ({
      id: match.mindbodyClientId,
      name: `${match.firstName} ${match.lastName}`.trim(),
      status: match.status,
      plans: match.contracts.filter((contract) => !contract.endDate || contract.endDate >= today).map((contract) => contract.contractName),
    })),
  });
}
