import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Finds members (clients with memberships in SynqIQ) by name or email, for
// the Memberships search page and its autocomplete. Names starting with
// what was typed come first ("paige" -> every Paige, then e.g. "McPaige").

export type MemberMatch = {
  mindbodyClientId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  status: string;
  contracts: { contractName: string; endDate: string | null; nextBillDate: string | null; nextBillTotalCents: number | null }[];
};

// Only letters, digits and a few name/email characters reach the filter.
export const cleanQuery = (raw: string) =>
  raw
    .replace(/[^\p{L}\p{N}@.'\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

export function rankMatch(match: Pick<MemberMatch, "firstName" | "lastName" | "email">, query: string): number {
  const q = query.toLowerCase();
  const first = match.firstName.toLowerCase();
  const last = match.lastName.toLowerCase();
  const full = `${first} ${last}`;
  if (full === q) return 0;
  if (full.startsWith(q)) return 1;
  if (last.startsWith(q)) return 2;
  if ((match.email ?? "").toLowerCase().startsWith(q)) return 3;
  return 4;
}

export async function searchMembers(supabase: ScopedSupabaseClient, organizationId: string, rawQuery: string, limit: number): Promise<MemberMatch[]> {
  const query = cleanQuery(rawQuery);
  if (query.length < 2) return [];
  type ClientRow = { mindbody_client_id: string; first_name: string; last_name: string; email: string | null; status: string };
  const words = query.split(" ");
  let clientQuery = supabase
    .from("clients")
    .select("mindbody_client_id, first_name, last_name, email, status")
    .eq("organization_id", organizationId)
    .not("mindbody_client_id", "is", null);
  clientQuery =
    words.length >= 2
      ? clientQuery.ilike("first_name", `${words[0]}%`).ilike("last_name", `${words.slice(1).join(" ")}%`)
      : clientQuery.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`);
  const { data: clients } = await clientQuery.limit(300).returns<ClientRow[]>();
  const ids = (clients ?? []).map((client) => client.mindbody_client_id);
  if (!ids.length) return [];

  type ContractRow = {
    mindbody_client_id: string;
    contract_name: string;
    end_date: string | null;
    next_bill_date: string | null;
    next_bill_total_cents: number | null;
  };
  const contracts: ContractRow[] = [];
  for (let index = 0; index < ids.length; index += 150) {
    const { data } = await supabase
      .from("member_contracts")
      .select("mindbody_client_id, contract_name, end_date, next_bill_date, next_bill_total_cents")
      .eq("organization_id", organizationId)
      .in("mindbody_client_id", ids.slice(index, index + 150))
      .returns<ContractRow[]>();
    contracts.push(...(data ?? []));
  }
  const byClient = new Map<string, MemberMatch["contracts"]>();
  for (const contract of contracts) {
    byClient.set(contract.mindbody_client_id, [
      ...(byClient.get(contract.mindbody_client_id) ?? []),
      {
        contractName: contract.contract_name,
        endDate: contract.end_date,
        nextBillDate: contract.next_bill_date,
        nextBillTotalCents: contract.next_bill_total_cents,
      },
    ]);
  }

  return (clients ?? [])
    .filter((client) => byClient.has(client.mindbody_client_id))
    .map((client) => ({
      mindbodyClientId: client.mindbody_client_id,
      firstName: client.first_name,
      lastName: client.last_name,
      email: client.email,
      status: client.status,
      contracts: byClient.get(client.mindbody_client_id)!,
    }))
    .sort(
      (a, b) =>
        rankMatch(a, query) - rankMatch(b, query) ||
        (a.status === "Active" ? 0 : 1) - (b.status === "Active" ? 0 : 1) ||
        a.firstName.localeCompare(b.firstName) ||
        a.lastName.localeCompare(b.lastName),
    )
    .slice(0, limit);
}
