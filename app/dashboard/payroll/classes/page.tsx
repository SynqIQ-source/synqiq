import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { EmptyReport, PersonCard } from "@/components/payroll/person-card";
import { PayRange } from "@/components/payroll/pay-range";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildPayroll } from "@/lib/payroll/report";
import { money } from "@/lib/payroll/details";
import { resolvePayRange } from "@/lib/payroll/period";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Club Admin: every class each instructor was paid for in the period -- date,
// time, attendees, the pay rate assigned to them for that class, the base,
// the incentive bonus and the earning -- totalled per instructor.
export default async function ClassPayPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const { from, to, presets } = resolvePayRange(await searchParams, zone);
  const payroll = await buildPayroll(staff.organizationId, from, to, admin);
  const local = (iso: string) => DateTime.fromISO(iso).setZone(zone);

  const people = payroll.people
    .filter((person) => person.classes.length)
    .map((person) => {
      const classes = [...person.classes].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const totals = classes.reduce(
        (acc, item) => ({
          heads: acc.heads + item.heads,
          base: acc.base + item.baseCents,
          incentive: acc.incentive + item.incentiveCents,
          amount: acc.amount + item.amountCents,
        }),
        { heads: 0, base: 0, incentive: 0, amount: 0 },
      );
      return { person, classes, totals };
    });
  const grand = people.reduce((sum, entry) => sum + entry.totals.amount, 0);

  return (
    <DashboardShell
      title="Class Pay"
      description="Every class each instructor taught: date, time, attendees, their pay rate for the class, the base, the incentive bonus and the earning."
    >
      <div className="space-y-6">
        <PayRange path="/dashboard/payroll/classes" from={from} to={to} presets={presets} />
        <p className="text-sm text-muted-foreground">
          {people.reduce((n, entry) => n + entry.classes.length, 0)} classes · {money(grand)}. Attendees are paid clients (signed in, or a
          no-show that used a session). The incentive bonus is the per-person amount above the base. Rates are set on{" "}
          <Link href="/dashboard/pay-rates" className="underline">
            Pay Rates
          </Link>
          .
        </p>

        {people.length === 0 ? (
          <EmptyReport>No classes taught in these dates.</EmptyReport>
        ) : (
          people.map(({ person, classes, totals }) => (
            <PersonCard
              key={person.staffId}
              staffId={person.staffId}
              name={person.name}
              totalCents={totals.amount}
              summary={`${classes.length} classes · ${totals.heads} attendees`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Attendees</TableHead>
                    <TableHead>Pay rate</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Incentive bonus</TableHead>
                    <TableHead className="text-right">Earning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((item) => (
                    <TableRow key={`${item.occurrenceId}-${item.name}`}>
                      <TableCell className="whitespace-nowrap">{local(item.startsAt).toFormat("ccc, LLL d")}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {local(item.startsAt).toFormat("h:mm a")}
                        {item.endsAt ? `–${local(item.endsAt).toFormat("h:mm a")}` : ""}
                      </TableCell>
                      <TableCell>
                        <Link href={`/dashboard/classes/${item.occurrenceId}`} className="font-medium hover:underline">
                          {item.name.trim()}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.heads}</TableCell>
                      <TableCell className="text-sm">
                        {item.rateName ?? <span className="text-destructive">No rate</span>}
                        {item.rateDetail ? <span className="block text-xs text-muted-foreground">{item.rateDetail}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(item.baseCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.incentiveCents ? money(item.incentiveCents) : "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(item.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>Total for {person.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.heads}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{money(totals.base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(totals.incentive)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(totals.amount)}</TableCell>
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
