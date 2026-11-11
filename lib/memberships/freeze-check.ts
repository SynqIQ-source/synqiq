import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// A member whose membership is on freeze (Mindbody suspends the contract's
// autopay while it's frozen) shouldn't be sold a new membership: staff should
// unfreeze the existing one. The checkout screen and the member profile show
// FREEZE_NOTICE; a new membership sold anyway earns no commission.

export const FREEZE_NOTICE =
  "This member's membership is frozen. To bring them back, unfreeze their membership instead of selling a new one. A new membership sold to a frozen member doesn't earn commission.";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type FrozenContract = { contractId: number; name: string; clientId: string };

// Contracts on freeze (autopay suspended) for these clients, still in force.
export async function frozenContracts(
  admin: Admin,
  organizationId: string,
  clientIds: string[],
  onDay?: string,
): Promise<FrozenContract[]> {
  const day = onDay ?? new Date().toISOString().slice(0, 10);
  const found: FrozenContract[] = [];
  for (let i = 0; i < clientIds.length; i += 300) {
    const { data } = await admin
      .from("member_contracts")
      .select("mindbody_client_contract_id, mindbody_client_id, contract_name, start_date, end_date, termination_date")
      .eq("organization_id", organizationId)
      .eq("autopay_status", "Suspended")
      .in("mindbody_client_id", clientIds.slice(i, i + 300));
    for (const row of data ?? []) {
      if (!isInForce(row, day)) continue;
      found.push({
        contractId: Number(row.mindbody_client_contract_id),
        name: (row.contract_name as string | null) ?? "Membership",
        clientId: row.mindbody_client_id as string,
      });
    }
  }
  return found;
}

export function isInForce(row: { start_date?: unknown; end_date?: unknown; termination_date?: unknown }, day: string): boolean {
  const date = (value: unknown) => (value ? String(value).slice(0, 10) : null);
  const start = date(row.start_date);
  const end = date(row.termination_date) ?? date(row.end_date);
  return (!start || start <= day) && (!end || end >= day);
}
