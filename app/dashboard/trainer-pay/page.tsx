import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin, isTrainerAccess } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTrainerPilot } from "@/lib/trainer/pilot";
import { loadPeriod, recentPeriods } from "@/lib/trainer/pay-periods";
import { PilotOff } from "../trainer-calendar/pilot-off";
import { PeriodActions } from "./period-actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ start?: string }> };

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const STATUS: Record<string, string> = { open: "Open", approved: "Approved", locked: "Locked" };

// Trainer session pay by pay period (pilot). Club Admins see every trainer,
// approve and lock periods and download the CSV; a trainer sees only their own
// lines. Practice pay: not in the payroll export while Mindbody runs payroll.
export default async function TrainerPayPage({ searchParams }: Props) {
  const staff = await requireAccess(isTrainerAccess);
  const admin = createSupabaseAdminClient();
  const pilot = await getTrainerPilot(staff.organizationId);
  if (!pilot.on)
    return (
      <DashboardShell title="Trainer Session Pay" description="Trainer sessions pilot.">
        <PilotOff admin={isClubAdmin(staff)} />
      </DashboardShell>
    );
  const params = await searchParams;
  const today = DateTime.now().setZone(pilot.timezone).toISODate()!;
  const periods = recentPeriods(today);
  const start = params.start && /^\d{4}-\d{2}-\d{2}$/.test(params.start) ? params.start : periods.current.startsOn;
  const seesAll = isClubAdmin(staff);
  const data = await loadPeriod(admin, staff.organizationId, start, seesAll ? undefined : staff.id);
  const total = data.lines.reduce((sum, line) => sum + line.amountCents, 0);
  const label = (p: { startsOn: string; endsOn: string }) =>
    `${DateTime.fromISO(p.startsOn).toFormat("LLL d")} – ${DateTime.fromISO(p.endsOn).toFormat("LLL d")}`;

  return (
    <DashboardShell
      title="Trainer Session Pay"
      description={
        seesAll
          ? "Pilot: pay for trainer sessions completed in SynqIQ, by pay period. Practice only; Mindbody still runs payroll."
          : "Pilot: your pay for sessions completed in SynqIQ, by pay period. Practice only; Mindbody still runs payroll."
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-400 text-amber-900 dark:text-amber-200">
          Pilot
        </Badge>
        {[periods.next, ...periods.list].map((p) => (
          <Link
            key={p.startsOn}
            href={`/dashboard/trainer-pay?start=${p.startsOn}`}
            className={`rounded-md border px-2 py-1 text-sm ${p.startsOn === data.period.startsOn ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {label(p)}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {label(data.period)} <Badge variant={data.status === "locked" ? "default" : "outline"}>{STATUS[data.status]}</Badge>
          </CardTitle>
          <CardDescription>
            {data.status === "locked"
              ? "Locked: nothing in this period can change. Corrections go into the next open period."
              : data.status === "approved"
                ? "Approved. Lock it to make it final."
                : "Open: sessions completed in this period, and corrections, land here."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {seesAll ? (
            <PeriodActions start={data.period.startsOn} status={data.status} />
          ) : null}
          {data.totals.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trainer</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.totals.map((t) => (
                  <TableRow key={t.staffId}>
                    <TableCell>{t.staffName}</TableCell>
                    <TableCell className="text-right">{t.sessions}</TableCell>
                    <TableCell className="text-right font-medium">{money(t.amountCents)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold">{money(total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No trainer session pay in this period.</p>
          )}
        </CardContent>
      </Card>

      {data.lines.length ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Lines</CardTitle>
            <CardDescription>
              One line per closed-out session at the rate in effect on its date (copied onto the line). Corrections appear as reversal lines
              with who made them and why; nothing is deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {seesAll ? <TableHead>Trainer</TableHead> : null}
                  <TableHead>Session</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Pay</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((line) => (
                  <TableRow key={line.id} className={line.reversal ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}>
                    <TableCell className="whitespace-nowrap">{DateTime.fromISO(line.workDate).toFormat("LLL d")}</TableCell>
                    {seesAll ? <TableCell>{line.staffName}</TableCell> : null}
                    <TableCell>
                      {line.description}
                      {line.reason ? <span className="block text-xs text-muted-foreground">Reason: {line.reason}</span> : null}
                    </TableCell>
                    <TableCell>{line.clientName}</TableCell>
                    <TableCell className="text-right">
                      {line.valueCents == null ? "—" : money(line.valueCents)}
                      {line.valueEstimated ? <span className="text-xs text-muted-foreground"> est.</span> : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {line.rateName ?? "No rate set"}
                      {line.payPercent != null && line.payPercent !== 100 ? ` × ${line.payPercent}%` : ""}
                    </TableCell>
                    <TableCell className="text-right font-medium">{money(line.amountCents)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{line.createdBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </DashboardShell>
  );
}
