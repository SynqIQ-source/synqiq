import { DateTime } from "luxon";
import { Download } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadTimesheet, resolveRange } from "@/lib/time-clock/timesheet";
import { forgotClockOut, hoursLabel, shiftMinutes, totalsByStaff } from "@/lib/time-clock/hours";
import { toLocalInput } from "@/lib/time-clock/local-time";
import { AddShift, EditShift } from "./timesheet-actions";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Club Admin timesheet: hours per person for a date range, every shift
// (fix times or a missed clock-out, add a forgotten shift, all with a
// reason), the change log, and a CSV export for payroll.
export default async function TimesheetsPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const { data: org } = await createSupabaseAdminClient()
    .from("organizations")
    .select("timezone")
    .eq("id", staff.organizationId)
    .maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const { from, to } = resolveRange(await searchParams, zone);
  const { timezone, punches, edits, people } = await loadTimesheet(staff.organizationId, from, to);
  const now = new Date();
  const totals = totalsByStaff(punches, now);
  const summary = [...totals.entries()]
    .map(([staffId, total]) => ({ staffId, name: punches.find((punch) => punch.staffId === staffId)?.name ?? "Unknown", ...total }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const local = (iso: string) => DateTime.fromISO(iso).setZone(timezone);
  const presets = [
    {
      label: "This week",
      from: DateTime.now().setZone(timezone).startOf("week").toISODate()!,
      to: DateTime.now().setZone(timezone).toISODate()!,
    },
    {
      label: "Last week",
      from: DateTime.now().setZone(timezone).startOf("week").minus({ weeks: 1 }).toISODate()!,
      to: DateTime.now().setZone(timezone).startOf("week").minus({ days: 1 }).toISODate()!,
    },
  ];
  const describe = (value: { clock_in_at?: string; clock_out_at?: string | null } | null) =>
    value?.clock_in_at
      ? `${local(value.clock_in_at).toFormat("LLL d h:mm a")} – ${value.clock_out_at ? local(value.clock_out_at).toFormat("h:mm a") : "open"}`
      : "—";

  return (
    <DashboardShell
      title="Timesheets"
      description="Hours from the time clock. Fix a missed clock-out or add a forgotten shift (with a reason), then export for payroll."
      actions={
        <Button asChild variant="outline" size="sm">
          <a href={`/api/time-clock/export?from=${from}&to=${to}`}>
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
          {presets.map((preset) => (
            <Button key={preset.label} asChild variant="ghost" size="sm">
              <a href={`/dashboard/timesheets?from=${preset.from}&to=${preset.to}`}>{preset.label}</a>
            </Button>
          ))}
        </form>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Hours</CardTitle>
            <CardDescription>
              {DateTime.fromISO(from).toFormat("LLL d")} – {DateTime.fromISO(to).toFormat("LLL d, yyyy")}. Open shifts count up to now.
            </CardDescription>
          </CardHeader>
          {summary.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody clocked in during these dates.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Shifts</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row) => (
                  <TableRow key={row.staffId}>
                    <TableCell className="font-medium">
                      {row.name} {row.open ? <Badge variant="secondary">On the clock</Badge> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.shifts}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{hoursLabel(row.minutes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Shifts</CardTitle>
          </CardHeader>
          {punches.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No shifts.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...punches].reverse().map((punch) => (
                    <TableRow key={punch.id}>
                      <TableCell className="font-medium">
                        {punch.name}
                        {punch.source === "admin" ? (
                          <span className="block text-xs text-muted-foreground">Added by a Club Admin</span>
                        ) : null}
                        {punch.source !== "admin" && punch.edited ? (
                          <span className="block text-xs text-muted-foreground">Edited</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{local(punch.clockIn).toFormat("ccc, LLL d")}</TableCell>
                      <TableCell className="tabular-nums">{local(punch.clockIn).toFormat("h:mm a")}</TableCell>
                      <TableCell className="tabular-nums">
                        {punch.clockOut ? (
                          local(punch.clockOut).toFormat(
                            local(punch.clockOut).hasSame(local(punch.clockIn), "day") ? "h:mm a" : "LLL d h:mm a",
                          )
                        ) : forgotClockOut(punch.clockIn, punch.clockOut, now) ? (
                          <Badge variant="destructive">Missed clock-out?</Badge>
                        ) : (
                          <Badge variant="secondary">On the clock</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hoursLabel(shiftMinutes(punch.clockIn, punch.clockOut, now))}
                      </TableCell>
                      <TableCell className="text-right">
                        <EditShift
                          id={punch.id}
                          clockIn={toLocalInput(punch.clockIn, timezone)}
                          clockOut={toLocalInput(punch.clockOut, timezone)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

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
            <CardDescription>Every shift a Club Admin added, changed or removed (latest 50).</CardDescription>
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
