import Link from "next/link";
import { Download } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { PayRange } from "@/components/payroll/pay-range";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildPayroll } from "@/lib/payroll/report";
import { money } from "@/lib/payroll/details";
import { resolvePayRange } from "@/lib/payroll/period";
import { hoursLabel } from "@/lib/time-clock/hours";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Club Admin: payroll for a pay period, one line per person -- sessions
// serviced, hourly, class earnings and commission, and the total. Each amount
// opens its detail report (Sessions Serviced, Timesheets, Class Pay,
// Commission Report) at that person; the CSV is in the Mindbody export's columns.
export default async function PayrollPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const { from, to, presets } = resolvePayRange(await searchParams, zone);
  const payroll = await buildPayroll(staff.organizationId, from, to, admin);

  const sum = (list: { amountCents: number }[]) => list.reduce((total, item) => total + item.amountCents, 0);
  const rows = payroll.people.map((person) => ({
    person,
    sessions: sum(person.sessions),
    classes: sum(person.classes),
  }));
  const totals = rows.reduce(
    (acc, row) => ({
      sessions: acc.sessions + row.sessions,
      hourly: acc.hourly + row.person.hourly.amountCents,
      classes: acc.classes + row.classes,
      commission: acc.commission + row.person.commissionCents,
      total: acc.total + row.person.totalCents,
    }),
    { sessions: 0, hourly: 0, classes: 0, commission: 0, total: 0 },
  );
  const range = `from=${from}&to=${to}`;
  const cell = (cents: number, href: string, note: string | null) =>
    cents || note ? (
      <Link href={href} className="hover:underline">
        {money(cents)}
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </Link>
    ) : (
      "—"
    );

  return (
    <DashboardShell
      title="Payroll"
      description="Each person's pay for the period: sessions serviced, hourly, class earnings and commission. Click an amount to see every line behind it."
      actions={
        <Button asChild variant="outline" size="sm">
          <a href={`/api/payroll/export?${range}`}>
            <Download /> Export CSV
          </a>
        </Button>
      }
    >
      <div className="space-y-6">
        <PayRange path="/dashboard/payroll" from={from} to={to} presets={presets} />

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Total {money(totals.total)}</CardTitle>
            <CardDescription>
              Rates come from{" "}
              <Link href="/dashboard/pay-rates" className="underline">
                Pay Rates
              </Link>
              ; sessions and classes are from Mindbody&apos;s records until SynqIQ takes over. A red tag means something couldn&apos;t
              be paid because no rate is set.
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Sessions serviced</TableHead>
                  <TableHead className="text-right">Hourly</TableHead>
                  <TableHead className="text-right">Class earnings</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Total pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ person, sessions, classes }) => {
                  const anchor = `#p-${person.staffId}`;
                  return (
                    <TableRow key={person.staffId}>
                      <TableCell className="font-medium">
                        {person.name}
                        {person.missingRates.length ? (
                          <Badge variant="destructive" className="ml-1">
                            No {person.missingRates.join(", ")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          sessions,
                          `/dashboard/payroll/sessions?${range}${anchor}`,
                          person.sessions.length ? `${person.sessions.length} sessions` : null,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          person.hourly.amountCents,
                          `/dashboard/timesheets?${range}${anchor}`,
                          person.hourly.minutes ? `${hoursLabel(person.hourly.minutes)}` : null,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          classes,
                          `/dashboard/payroll/classes?${range}${anchor}`,
                          person.classes.length ? `${person.classes.length} classes` : null,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          person.commissionCents,
                          `/dashboard/payroll/commissions?${range}${anchor}`,
                          person.commissionLines ? `${person.commissionLines} sales` : null,
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(person.totalCents)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {rows.length ? (
                <TableFooter>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{money(totals.sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(totals.hourly)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(totals.classes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(totals.commission)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(totals.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
          {rows.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">No pay in these dates.</p> : null}
        </Card>
      </div>
    </DashboardShell>
  );
}
