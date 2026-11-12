import Link from "next/link";
import { DateTime } from "luxon";
import { Download } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildPayroll } from "@/lib/payroll/report";
import { hoursLabel } from "@/lib/time-clock/hours";
import { SynqiqSessions } from "./synqiq-sessions";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Two-week pay periods, Saturday to Friday, counted from a known period start.
const PERIOD_ANCHOR = "2026-10-24";

function periods(timezone: string) {
  const today = DateTime.now().setZone(timezone).startOf("day");
  const anchor = DateTime.fromISO(PERIOD_ANCHOR, { zone: timezone });
  const index = Math.floor(today.diff(anchor, "days").days / 14);
  const start = (i: number) => anchor.plus({ days: 14 * i });
  return {
    current: { from: start(index).toISODate()!, to: start(index).plus({ days: 13 }).toISODate()! },
    last: {
      from: start(index - 1).toISODate()!,
      to: start(index - 1)
        .plus({ days: 13 })
        .toISODate()!,
    },
  };
}

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Club Admin: payroll for a pay period -- hourly (time clock), class pay,
// session pay and commission per person, with every class and session behind
// the numbers, and the CSV export in the Mindbody export's columns.
export default async function PayrollPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const preset = periods(zone);
  const params = await searchParams;
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : preset.last.from;
  const to =
    params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) && params.to >= from ? params.to : from === preset.last.from ? preset.last.to : from;
  const [payroll, { data: eventRows }, { data: staffNames }] = await Promise.all([
    buildPayroll(staff.organizationId, from, to, admin),
    admin
      .from("payroll_events")
      .select("id, staff_id, work_date, description, client_name, value_cents, value_source, pay_rate_name, amount_cents, no_show")
      .eq("organization_id", staff.organizationId)
      .eq("kind", "session")
      .is("voided_at", null)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .limit(2000),
    admin.from("staff").select("id, display_name").eq("organization_id", staff.organizationId),
  ]);
  const staffName = new Map((staffNames ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const local = (iso: string) => DateTime.fromISO(iso).setZone(zone);
  const sum = (list: { amountCents: number }[]) => list.reduce((total, item) => total + item.amountCents, 0);
  const grand = payroll.people.reduce((total, person) => total + person.totalCents, 0);
  const estimated = payroll.people.reduce((n, person) => n + person.sessions.filter((s) => s.estimated).length, 0);
  const unpriced = payroll.people.reduce(
    (n, person) => n + person.sessions.filter((s) => s.valueCents == null && s.rateName?.includes("%")).length,
    0,
  );

  return (
    <DashboardShell
      title="Payroll"
      description="Pay for a pay period: hourly (time clock), classes, sessions and commission. Open a person to see every class and session behind their pay."
      actions={
        <Button asChild variant="outline" size="sm">
          <a href={`/api/payroll/export?from=${from}&to=${to}`}>
            <Download /> Export CSV
          </a>
        </Button>
      }
    >
      <div className="space-y-6">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="text-sm">
            From
            <Input type="date" name="from" defaultValue={from} className="h-9" />
          </label>
          <label className="text-sm">
            To
            <Input type="date" name="to" defaultValue={to} className="h-9" />
          </label>
          <Button type="submit" variant="outline" size="sm">
            Show
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`/dashboard/payroll?from=${preset.last.from}&to=${preset.last.to}`}>Last pay period</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`/dashboard/payroll?from=${preset.current.from}&to=${preset.current.to}`}>This pay period</a>
          </Button>
        </form>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>
              {DateTime.fromISO(from).toFormat("LLL d")} – {DateTime.fromISO(to).toFormat("LLL d, yyyy")} · {money(grand)}
            </CardTitle>
            <CardDescription>
              Rates come from{" "}
              <Link href="/dashboard/pay-rates" className="underline">
                Pay Rates
              </Link>
              , commission from{" "}
              <Link href={`/dashboard/commissions?from=${from}&to=${to}`} className="underline">
                Commissions
              </Link>
              , hours from{" "}
              <Link href={`/dashboard/timesheets?from=${from}&to=${to}`} className="underline">
                Timesheets
              </Link>
              .
              {estimated
                ? ` ${estimated} session value${estimated === 1 ? " uses" : "s use"} the pack's usual price (the client's own purchase isn't on file).`
                : ""}
              {unpriced
                ? ` ${unpriced} percent-paid session${unpriced === 1 ? " has" : "s have"} no pack price and pay $0 -- check those.`
                : ""}
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Hourly</TableHead>
                <TableHead className="text-right">Classes</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payroll.people.map((person) => (
                <TableRow key={person.staffId}>
                  <TableCell className="font-medium">
                    <a href={`#p-${person.staffId}`} className="hover:underline">
                      {person.name}
                    </a>
                    {person.missingRates.length ? (
                      <Badge variant="destructive" className="ml-1">
                        No {person.missingRates.join(", ")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {person.hourly.minutes ? (
                      <>
                        {money(person.hourly.amountCents)}
                        <span className="block text-xs text-muted-foreground">{hoursLabel(person.hourly.minutes)} h</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {person.classes.length ? (
                      <>
                        {money(sum(person.classes))}
                        <span className="block text-xs text-muted-foreground">{person.classes.length} classes</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {person.sessions.length ? (
                      <>
                        {money(sum(person.sessions))}
                        <span className="block text-xs text-muted-foreground">{person.sessions.length} sessions</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{person.commissionCents ? money(person.commissionCents) : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(person.totalCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {payroll.people
          .filter((person) => person.classes.length || person.sessions.length)
          .map((person) => (
            <details key={person.staffId} id={`p-${person.staffId}`} className="rounded-lg border bg-card">
              <summary className="cursor-pointer px-6 py-3 font-medium">
                {person.name} · {money(person.totalCents)}
              </summary>
              <div className="overflow-x-auto border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>Detail</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead className="text-right">Pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {person.classes.map((item) => (
                      <TableRow key={item.occurrenceId}>
                        <TableCell className="text-sm whitespace-nowrap">{local(item.startsAt).toFormat("ccc LLL d, h:mm a")}</TableCell>
                        <TableCell>
                          <Link href={`/dashboard/classes/${item.occurrenceId}`} className="hover:underline">
                            {item.name.trim()}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{item.heads} paid clients</TableCell>
                        <TableCell className="text-sm">{item.rateName ?? <span className="text-destructive">No rate</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(item.amountCents)}</TableCell>
                      </TableRow>
                    ))}
                    {person.sessions.map((session) => (
                      <TableRow key={session.appointmentId}>
                        <TableCell className="text-sm whitespace-nowrap">{local(session.startsAt).toFormat("ccc LLL d, h:mm a")}</TableCell>
                        <TableCell>
                          {session.sessionType}
                          {session.noShow ? (
                            <Badge variant="secondary" className="ml-1">
                              No-show
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {session.client} {session.service ? `· ${session.service}` : ""}
                          {session.valueCents != null
                            ? ` · ${money(session.valueCents)}/session${session.estimated ? " (usual price)" : ""}`
                            : ""}
                        </TableCell>
                        <TableCell className="text-sm">{session.rateName ?? <span className="text-destructive">No rate</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(session.amountCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          ))}
      </div>
      <SynqiqSessions
        events={(eventRows ?? []).map((row) => ({
          id: row.id as string,
          staffName: staffName.get(row.staff_id as string) ?? "Unknown",
          workDate: String(row.work_date),
          description: row.description as string,
          clientName: (row.client_name as string | null) ?? null,
          valueCents: row.value_cents == null ? null : Number(row.value_cents),
          valueSource: (row.value_source as string | null) ?? null,
          rateName: (row.pay_rate_name as string | null) ?? null,
          amountCents: Number(row.amount_cents),
          noShow: Boolean(row.no_show),
        }))}
        mindbodyByStaff={Object.fromEntries(
          payroll.people.filter((person) => person.sessions.length).map((person) => [person.name, sum(person.sessions)]),
        )}
      />
    </DashboardShell>
  );
}
