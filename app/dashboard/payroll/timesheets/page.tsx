import Link from "next/link";
import { DateTime } from "luxon";
import { Download } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { EmptyReport, PersonCard } from "@/components/payroll/person-card";
import { PayRange } from "@/components/payroll/pay-range";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hourlyPayCents, money } from "@/lib/payroll/details";
import { resolvePayRange } from "@/lib/payroll/period";
import { loadTimesheet } from "@/lib/time-clock/timesheet";
import { forgotClockOut, hoursLabel, shiftMinutes } from "@/lib/time-clock/hours";
import { toLocalInput } from "@/lib/time-clock/local-time";
import { AddShift, EditShift } from "./timesheet-actions";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Club Admin timesheet, one section per employee: every shift with the date,
// time in, time out, whether it was edited (when and by whom) and its hours,
// then the employee's total hours and pay at their hourly rate. Fix a missed
// clock-out or add a forgotten shift (with a reason); the change log and the
// CSV export are below.
export default async function TimesheetsPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const { data: org } = await createSupabaseAdminClient()
    .from("organizations")
    .select("timezone")
    .eq("id", staff.organizationId)
    .maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const { from, to, presets } = resolvePayRange(await searchParams, zone);
  const { timezone, punches, edits, people, shiftEdits, hourlyRates } = await loadTimesheet(staff.organizationId, from, to);
  const now = new Date();
  const local = (iso: string) => DateTime.fromISO(iso).setZone(timezone);
  const describe = (value: { clock_in_at?: string; clock_out_at?: string | null } | null) =>
    value?.clock_in_at
      ? `${local(value.clock_in_at).toFormat("LLL d h:mm a")} – ${value.clock_out_at ? local(value.clock_out_at).toFormat("h:mm a") : "open"}`
      : "—";

  const employees = [...new Set(punches.map((punch) => punch.staffId))]
    .map((staffId) => {
      const shifts = punches.filter((punch) => punch.staffId === staffId);
      const minutes = shifts.reduce((sum, punch) => sum + shiftMinutes(punch.clockIn, punch.clockOut, now), 0);
      const rateCents = hourlyRates.get(staffId) ?? null;
      return { staffId, name: shifts[0].name, shifts, minutes, rateCents, payCents: hourlyPayCents(minutes, rateCents) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalMinutes = employees.reduce((sum, e) => sum + e.minutes, 0);
  const totalPay = employees.reduce((sum, e) => sum + e.payCents, 0);
  const rateLabel = (cents: number | null) => (cents == null ? "no hourly rate" : `${money(cents)}/hr`);

  return (
    <DashboardShell
      title="Timesheets"
      description="Every shift per employee: time in, time out, any edit (when and by whom) and hours, with total hours and pay at their hourly rate."
      actions={
        <Button asChild variant="outline" size="sm">
          <a href={`/api/time-clock/export?from=${from}&to=${to}`}>
            <Download /> Export CSV
          </a>
        </Button>
      }
    >
      <div className="space-y-6">
        <PayRange path="/dashboard/payroll/timesheets" from={from} to={to} presets={presets} />
        <p className="text-sm text-muted-foreground">
          {employees.length} employees · {hoursLabel(totalMinutes)} · {money(totalPay)}. Open shifts count up to now. Hourly rates are set on{" "}
          <Link href="/dashboard/pay-rates" className="underline">
            Pay Rates
          </Link>
          .
        </p>

        {employees.length === 0 ? (
          <EmptyReport>Nobody clocked in during these dates.</EmptyReport>
        ) : (
          employees.map((employee) => (
            <PersonCard
              key={employee.staffId}
              staffId={employee.staffId}
              name={employee.name}
              totalCents={employee.payCents}
              summary={`${employee.shifts.length} shifts · ${hoursLabel(employee.minutes)} · ${rateLabel(employee.rateCents)}`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time in</TableHead>
                    <TableHead>Time out</TableHead>
                    <TableHead>Edited</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employee.shifts.map((punch) => {
                    const changes = shiftEdits.get(punch.id) ?? [];
                    return (
                      <TableRow key={punch.id}>
                        <TableCell className="whitespace-nowrap">{local(punch.clockIn).toFormat("ccc, LLL d")}</TableCell>
                        <TableCell className="tabular-nums">{local(punch.clockIn).toFormat("h:mm a")}</TableCell>
                        <TableCell className="tabular-nums">
                          {punch.clockOut ? (
                            local(punch.clockOut).toFormat(local(punch.clockOut).hasSame(local(punch.clockIn), "day") ? "h:mm a" : "LLL d h:mm a")
                          ) : forgotClockOut(punch.clockIn, punch.clockOut, now) ? (
                            <Badge variant="destructive">Missed clock-out?</Badge>
                          ) : (
                            <Badge variant="secondary">On the clock</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {changes.length ? (
                            changes.map((change, i) => (
                              <span key={i} className="block" title={change.reason}>
                                {change.action === "add" ? "Added" : "Edited"} {local(change.at).toFormat("LLL d, h:mm a")} by {change.by}
                              </span>
                            ))
                          ) : punch.source === "admin" ? (
                            "Added by a Club Admin"
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{hoursLabel(shiftMinutes(punch.clockIn, punch.clockOut, now))}</TableCell>
                        <TableCell className="text-right">
                          <EditShift
                            id={punch.id}
                            clockIn={toLocalInput(punch.clockIn, timezone)}
                            clockOut={toLocalInput(punch.clockOut, timezone)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4}>
                      Total for {employee.name} · {hoursLabel(employee.minutes)} × {rateLabel(employee.rateCents)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{hoursLabel(employee.minutes)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {employee.rateCents == null ? <span className="text-destructive">No rate</span> : money(employee.payCents)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </PersonCard>
          ))
        )}

        <Card>
          <CardHeader>
            <CardTitle>Add a shift</CardTitle>
            <CardDescription>For someone who forgot to clock in. Times are studio time.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddShift people={people} />
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Changes</CardTitle>
            <CardDescription>Every shift a Club Admin added, changed or removed (latest 50), with the reason.</CardDescription>
          </CardHeader>
          {edits.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Shift of</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {edits.map((edit) => (
                    <TableRow key={edit.id}>
                      <TableCell className="text-sm text-muted-foreground">{local(edit.createdAt).toFormat("LLL d, h:mm a")}</TableCell>
                      <TableCell>{edit.staffName}</TableCell>
                      <TableCell className="text-sm">
                        {edit.action === "add"
                          ? `Added ${describe(edit.after)}`
                          : edit.action === "delete"
                            ? `Removed ${describe(edit.before)}`
                            : `${describe(edit.before)} → ${describe(edit.after)}`}
                      </TableCell>
                      <TableCell className="text-sm">{edit.reason}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{edit.editedBy}</TableCell>
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
