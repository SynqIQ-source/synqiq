import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";

type SearchParams = Promise<{ q?: string }>;

const money = (cents: number | null) =>
  cents === null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

// Club Admins find a member to see and edit their billing.
export default async function MembershipsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const { q = "" } = await searchParams;
  // Only letters, digits and a few name/email characters reach the filter.
  const query = q.replace(/[^\p{L}\p{N}@.'\- ]/gu, " ").trim().slice(0, 80);

  type ClientRow = { mindbody_client_id: string | null; first_name: string; last_name: string; email: string | null; status: string };
  type ContractRow = {
    mindbody_client_id: string;
    contract_name: string;
    end_date: string | null;
    autopay_status: string | null;
    next_bill_date: string | null;
    next_bill_total_cents: number | null;
  };
  let results: { client: ClientRow; contracts: ContractRow[] }[] = [];

  if (query.length >= 2) {
    const words = query.split(/\s+/);
    let clientQuery = supabase
      .from("clients")
      .select("mindbody_client_id, first_name, last_name, email, status")
      .eq("organization_id", staff.organizationId)
      .not("mindbody_client_id", "is", null);
    clientQuery =
      words.length >= 2
        ? clientQuery.ilike("first_name", `%${words[0]}%`).ilike("last_name", `%${words.slice(1).join(" ")}%`)
        : clientQuery.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`);
    const { data: clients } = await clientQuery.order("last_name").order("first_name").limit(200).returns<ClientRow[]>();
    const ids = (clients ?? []).map((client) => client.mindbody_client_id as string);
    const { data: contracts } = ids.length
      ? await supabase
          .from("member_contracts")
          .select("mindbody_client_id, contract_name, end_date, autopay_status, next_bill_date, next_bill_total_cents")
          .eq("organization_id", staff.organizationId)
          .in("mindbody_client_id", ids)
          .returns<ContractRow[]>()
      : { data: [] as ContractRow[] };
    const byClient = new Map<string, ContractRow[]>();
    for (const contract of contracts ?? []) byClient.set(contract.mindbody_client_id, [...(byClient.get(contract.mindbody_client_id) ?? []), contract]);
    results = (clients ?? [])
      .filter((client) => byClient.has(client.mindbody_client_id as string))
      .slice(0, 50)
      .map((client) => ({ client, contracts: byClient.get(client.mindbody_client_id as string)! }));
  }

  const today = DateTime.now().toISODate()!;
  return (
    <DashboardShell title="Memberships" description="Find a member to see their memberships and billing, and make billing edits.">
      <div className="space-y-6">
        <form className="flex max-w-xl gap-2" action="/dashboard/memberships">
          <Input name="q" defaultValue={q} placeholder="Member name or email" aria-label="Member name or email" autoFocus />
          <Button type="submit">Search</Button>
        </form>
        <p className="text-sm text-muted-foreground">
          <Link href="/dashboard/shadow-billing" className="underline underline-offset-4">
            Shadow Billing
          </Link>{" "}
          compares what SynqIQ would charge with what Mindbody charges.
        </p>

        {query.length >= 2 ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>Members</CardTitle>
              <CardDescription>
                {results.length === 0 ? "No members with memberships match." : `${results.length} with memberships`}
              </CardDescription>
            </CardHeader>
            {results.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Current memberships</TableHead>
                      <TableHead>Next bill</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map(({ client, contracts }) => {
                      const current = contracts.filter((contract) => !contract.end_date || contract.end_date >= today);
                      const next = current
                        .filter((contract) => contract.next_bill_date)
                        .sort((a, b) => (a.next_bill_date as string).localeCompare(b.next_bill_date as string))[0];
                      return (
                        <TableRow key={client.mindbody_client_id}>
                          <TableCell>
                            <Link href={`/dashboard/memberships/${client.mindbody_client_id}`} className="font-medium underline-offset-4 hover:underline">
                              {client.first_name} {client.last_name}
                            </Link>
                            <span className="block text-xs text-muted-foreground">{client.status}</span>
                          </TableCell>
                          <TableCell>{current.length ? current.map((contract) => contract.contract_name).join(", ") : "None current"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {next ? `${DateTime.fromISO(next.next_bill_date as string).toFormat("LLL d")} · ${money(next.next_bill_total_cents)}` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="pb-6" />
            )}
          </Card>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">Search by first and last name, or by email.</CardContent>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
