import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { searchMembers } from "@/lib/memberships/member-search";
import { frozenContracts } from "@/lib/memberships/freeze-check";
import { requireCheckoutApi } from "@/lib/pos/api";
import { applyNameSearch, searchTokens } from "@/lib/crm/search";
import { normalizeEmail, normalizePhone } from "@/lib/crm/normalize";

// Checkout buyer picker: members (Mindbody clients, with whether each is on
// freeze -- the screen then says to unfreeze instead of selling a
// membership) plus CRM guests and leads who aren't Mindbody clients yet
// (id "crm:<id>"), so a guest can buy their first membership.
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

  // CRM guests and leads (not yet Mindbody clients), by name, email or phone.
  const email = normalizeEmail(q);
  const phone = /\d{7}/.test(q.replace(/\D/g, "")) ? normalizePhone(q) : null;
  const tokens = searchTokens(q);
  let guests: { id: string; first_name: string; last_name: string; status: string }[] = [];
  if (email || phone || tokens.length) {
    let query = admin
      .from("crm_contacts")
      .select("id, first_name, last_name, status")
      .eq("organization_id", org)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .is("mindbody_client_id", null);
    query = email ? query.eq("email_normalized", email) : phone ? query.eq("phone_e164", phone) : applyNameSearch(query, tokens);
    const { data } = await query.order("updated_at", { ascending: false }).limit(5);
    guests = (data ?? []) as typeof guests;
  }
  return NextResponse.json({
    success: true,
    members: [
      ...matches.map((match) => ({
        id: match.mindbodyClientId,
        name: `${match.firstName} ${match.lastName}`.trim(),
        status: match.status,
        plans: match.contracts
          .filter((contract) => !contract.endDate || contract.endDate >= today)
          .map((contract) => contract.contractName),
        frozen: frozen.some((row) => row.clientId === match.mindbodyClientId),
      })),
      ...guests.map((guest) => ({
        id: `crm:${guest.id}`,
        name: `${guest.first_name} ${guest.last_name}`.trim(),
        status: guest.status === "guest" ? "Guest" : guest.status === "not_interested" ? "Lead (not interested)" : "Lead",
        plans: [] as string[],
        frozen: false,
      })),
    ],
  });
}
