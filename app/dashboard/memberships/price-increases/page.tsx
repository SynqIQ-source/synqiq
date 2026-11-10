import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { ContractTermsWarning } from "./contract-terms-warning";

const day = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d, yyyy");

// Club Admins' scheduled bulk price increases.
export default async function PriceIncreasesPage() {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;
  const [{ data: org }, { data: increases }] = await Promise.all([
    supabase.from("organizations").select("timezone, billing_cutover_date").eq("id", orgId).maybeSingle(),
    supabase
      .from("price_increases")
      .select("id, name, percent, effective_on, member_count, created_at, cancelled_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  ]);
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;
  const cutover = (org?.billing_cutover_date as string | undefined) ?? "2027-02-01";

  return (
    <DashboardShell
      title="Price Increases"
      description={`Schedule a % dues increase for a group of memberships. Increases can start on or after the billing switch (${day(cutover)}).`}
      actions={
        <Button asChild>
          <Link href="/dashboard/memberships/price-increases/new">New increase</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <ContractTermsWarning />
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Increases</CardTitle>
            <CardDescription>Nothing is charged or emailed from here. Mindbody still charges until the switch.</CardDescription>
          </CardHeader>
          {!increases?.length ? (
            <CardContent className="pb-6 text-sm text-muted-foreground">None yet.</CardContent>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Increase</TableHead>
                    <TableHead>Starts</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {increases.map((increase) => (
                    <TableRow key={increase.id as string}>
                      <TableCell>
                        <Link
                          href={`/dashboard/memberships/price-increases/${increase.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {increase.name as string}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Number(increase.percent)}%</TableCell>
                      <TableCell className="whitespace-nowrap">{day(increase.effective_on as string)}</TableCell>
                      <TableCell className="text-right tabular-nums">{(increase.member_count as number).toLocaleString()}</TableCell>
                      <TableCell>
                        {increase.cancelled_at ? (
                          <Badge variant="outline">Cancelled</Badge>
                        ) : (increase.effective_on as string) <= today ? (
                          <Badge variant="secondary">In effect</Badge>
                        ) : (
                          <Badge>Scheduled</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
