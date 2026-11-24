import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { EmptyReport, PersonCard } from "@/components/payroll/person-card";
import { PayRange } from "@/components/payroll/pay-range";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { byPerson, money } from "@/lib/payroll/details";
import { loadCommissionReport } from "@/lib/payroll/commission-report";
import { resolvePayRange } from "@/lib/payroll/period";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Club Admin: every commission line earned in the period, per person -- the
// sale, the client, what was bought, the pre-tax amount, the commission rate
// and the earning, and a note when a Club Admin changed the commission on
// that sale (with who and when). Returns show as negative clawbacks.
export default async function CommissionReportPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const { from, to, presets } = resolvePayRange(await searchParams, zone);
  const rows = await loadCommissionReport(admin, staff.organizationId, from, to, zone);
  const groups = byPerson(rows);
  const grand = groups.reduce((sum, group) => sum + group.totalCents, 0);
  const local = (iso: string) => DateTime.fromISO(iso).setZone(zone);

  return (
    <DashboardShell
      title="Commission Report"
      description="Every commission earned in the period: the sale, the client, what was purchased, the rate and the earning, with any change a Club Admin made."
    >
      <div className="space-y-6">
        <PayRange path="/dashboard/payroll/commissions" from={from} to={to} presets={presets} />
        <p className="text-sm text-muted-foreground">
          {rows.length} lines · {money(grand)}. Commission is on the pre-tax amount. Plans, rates and who earns on a sale are set on{" "}
          <Link href={`/dashboard/commissions?from=${from}&to=${to}`} className="underline">
            Commission Setup
          </Link>
          .
        </p>

        {groups.length === 0 ? (
          <EmptyReport>No commission earned in these dates.</EmptyReport>
        ) : (
          groups.map((group) => (
            <PersonCard
              key={group.staffId}
              staffId={group.staffId}
              name={group.staffName}
              totalCents={group.totalCents}
              summary={`${group.rows.length} lines`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Purchased</TableHead>
                    <TableHead className="text-right">Sale (pre-tax)</TableHead>
                    <TableHead>Commission rate</TableHead>
                    <TableHead className="text-right">Earning</TableHead>
                    <TableHead>Admin change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        {local(row.saleAt).toFormat("ccc, LLL d")}
                        <span className="block text-xs text-muted-foreground">{local(row.saleAt).toFormat("h:mm a")}</span>
                      </TableCell>
                      <TableCell className="font-medium">{row.client}</TableCell>
                      <TableCell className="text-sm">
                        {row.quantity !== 1 ? `${row.quantity} × ` : ""}
                        {row.item}
                        {row.clawback ? (
                          <Badge variant="outline" className="ml-1">
                            Returned
                          </Badge>
                        ) : null}
                        <span className="block text-xs text-muted-foreground">{row.condition}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.baseCents)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{row.rate}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(row.amountCents)}</TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">{row.adminNote ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5}>Total for {group.staffName}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(group.totalCents)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </PersonCard>
          ))
        )}
      </div>
    </DashboardShell>
  );
}
