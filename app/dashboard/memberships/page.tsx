import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cleanQuery, searchMembers } from "@/lib/memberships/member-search";
import { MemberSearch } from "./member-search";

type SearchParams = Promise<{ q?: string }>;

const money = (cents: number | null) =>
  cents === null
    ? "—"
    : (cents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      });

// Club Admins find a member to see and edit their billing.
export default async function MembershipsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const { q = "" } = await searchParams;
  const query = cleanQuery(q);
  const results = await searchMembers(supabase, staff.organizationId, query, 50);

  const today = DateTime.now().toISODate()!;
  return (
    <DashboardShell title="Memberships" description="Find a member to see their memberships and billing, and make billing edits.">
      <div className="space-y-6">
        <MemberSearch initialQuery={q} />
        <p className="text-sm text-muted-foreground">
          <Link href="/dashboard/shadow-billing" className="underline underline-offset-4">
            Shadow Billing
          </Link>{" "}
          compares what SynqIQ would charge with what Mindbody charges.{" "}
          <Link href="/dashboard/memberships/price-increases" className="underline underline-offset-4">
            Price Increases
          </Link>{" "}
          schedules a % dues increase for a group of memberships.
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
                    {results.map((member) => {
                      const current = member.contracts.filter((contract) => !contract.endDate || contract.endDate >= today);
                      const next = current
                        .filter((contract) => contract.nextBillDate)
                        .sort((a, b) => (a.nextBillDate as string).localeCompare(b.nextBillDate as string))[0];
                      return (
                        <TableRow key={member.mindbodyClientId}>
                          <TableCell>
                            <Link
                              href={`/dashboard/memberships/${member.mindbodyClientId}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {member.firstName} {member.lastName}
                            </Link>
                            <span className="block text-xs text-muted-foreground">{member.status}</span>
                          </TableCell>
                          <TableCell>
                            {current.length ? current.map((contract) => contract.contractName).join(", ") : "None current"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {next
                              ? `${DateTime.fromISO(next.nextBillDate as string).toFormat("LLL d")} · ${money(next.nextBillTotalCents)}`
                              : "—"}
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
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Start typing a name (e.g. &quot;paige&quot;) and pick from the list, or search by email.
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
