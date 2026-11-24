import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTrainerPilot } from "@/lib/trainer/pilot";
import { recentPeriods } from "@/lib/trainer/pay-periods";
import { periodContaining } from "@/lib/trainer/pilot-rules";
import { loadReconciliation } from "@/lib/trainer/reconciliation";
import { SESSION_STATUS_LABELS } from "@/lib/trainer/rules";
import { PilotOff } from "../trainer-calendar/pilot-off";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ start?: string }> };

const MINDBODY_LABEL: Record<string, string> = { Completed: "Completed", Arrived: "Arrived", NoShow: "No-show", LateCancelled: "Late cancel" };

// Club Admins: does SynqIQ agree with Mindbody? While Mindbody is the record,
// trainers in the pilot log each session in both. Read-only.
export default async function TrainerReconciliationPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const pilot = await getTrainerPilot(staff.organizationId);
  if (!pilot.on)
    return (
      <DashboardShell title="Session Reconciliation" description="Trainer sessions pilot.">
        <PilotOff admin />
      </DashboardShell>
    );
  const params = await searchParams;
  const today = DateTime.now().setZone(pilot.timezone).toISODate()!;
  const periods = recentPeriods(today, 6);
  const period = periodContaining(params.start && /^\d{4}-\d{2}-\d{2}$/.test(params.start) ? params.start : periods.current.startsOn);
  const to = period.endsOn < today ? period.endsOn : today;
  const data = await loadReconciliation(createSupabaseAdminClient(), staff.organizationId, period.startsOn, to, pilot.timezone);
  const differences = data.rows.filter((r) => r.kind !== "match" || r.statusDiffers);
  const balanceDiffs = data.balances.filter((b) => b.synqiq !== b.mindbody);
  const label = (p: { startsOn: string; endsOn: string }) =>
    `${DateTime.fromISO(p.startsOn).toFormat("LLL d")} – ${DateTime.fromISO(p.endsOn).toFormat("LLL d")}`;
  const fmt = (date: string) => DateTime.fromISO(date).toFormat("ccc LLL d");

  return (
    <DashboardShell
      title="Session Reconciliation"
      description="Pilot: trainer sessions closed out in SynqIQ compared with the appointments and pack balances synced from Mindbody. Read-only."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-400 text-amber-900 dark:text-amber-200">
          Pilot
        </Badge>
        {periods.list.map((p) => (
          <Link
            key={p.startsOn}
            href={`/dashboard/trainer-reconciliation?start=${p.startsOn}`}
            className={`rounded-md border px-2 py-1 text-sm ${p.startsOn === period.startsOn ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {label(p)}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "In both, same outcome", value: data.counts.matched, tone: "text-emerald-700 dark:text-emerald-400" },
          { label: "In both, outcome differs", value: data.counts.statusDiffers, tone: "text-amber-700 dark:text-amber-400" },
          { label: "Only in SynqIQ", value: data.counts.synqOnly, tone: "text-amber-700 dark:text-amber-400" },
          { label: "Only in Mindbody", value: data.counts.mindbodyOnly, tone: "text-amber-700 dark:text-amber-400" },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="pb-2">
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className={`text-3xl ${tile.value ? tile.tone : ""}`}>{tile.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Session differences</CardTitle>
          <CardDescription>
            Matched by trainer, client and day ({label(period)}, up to today). Mindbody is synced nightly, so today&apos;s sessions may show
            as &quot;only in SynqIQ&quot; until tomorrow. Only trainers with a SynqIQ session in this period are compared.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {differences.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Trainer</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>SynqIQ</TableHead>
                  <TableHead>Mindbody</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {differences.map((r) => (
                  <TableRow key={r.kind === "mindbody_only" ? `m${r.mindbody.id}` : `s${r.synq.id}`}>
                    <TableCell className="whitespace-nowrap">{fmt(r.kind === "mindbody_only" ? r.mindbody.date : r.synq.date)}</TableCell>
                    <TableCell>{r.trainer}</TableCell>
                    <TableCell>{r.client}</TableCell>
                    <TableCell>
                      {r.kind === "mindbody_only" ? (
                        <span className="text-amber-700 dark:text-amber-400">Missing</span>
                      ) : (
                        `${SESSION_STATUS_LABELS[r.synq.status] ?? r.synq.status} · ${r.synq.sessionType}`
                      )}
                    </TableCell>
                    <TableCell>
                      {r.kind === "synq_only" ? (
                        <span className="text-amber-700 dark:text-amber-400">Missing</span>
                      ) : (
                        `${MINDBODY_LABEL[r.mindbody.status] ?? r.mindbody.status} · ${r.mindbody.sessionType}`
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.rows.length ? "Everything matches for this period." : "No closed-out trainer sessions in SynqIQ in this period."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pack balances</CardTitle>
          <CardDescription>
            For the clients above: Mindbody&apos;s remaining sessions at the last nightly sync, and SynqIQ&apos;s balance (that number less
            sessions SynqIQ recorded since). A difference means SynqIQ recorded a session Mindbody hadn&apos;t yet, or the other way round.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {balanceDiffs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead className="text-right">Mindbody</TableHead>
                  <TableHead className="text-right">SynqIQ</TableHead>
                  <TableHead className="text-right">Used in SynqIQ since sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balanceDiffs.map((b, i) => (
                  <TableRow key={`${b.clientId}-${i}`}>
                    <TableCell>{b.clientName}</TableCell>
                    <TableCell>{b.pack}</TableCell>
                    <TableCell className="text-right">{b.mindbody}</TableCell>
                    <TableCell className="text-right">{b.synqiq}</TableCell>
                    <TableCell className="text-right">{b.usedInSynqiqSinceSync}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.balances.length ? "Every pack balance agrees with Mindbody." : "No Mindbody packs for these clients."}
            </p>
          )}
        </CardContent>
      </Card>
    </DashboardShell>
  );
}
