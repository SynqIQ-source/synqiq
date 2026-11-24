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
import { buildPayroll } from "@/lib/payroll/report";
import { byPerson, money } from "@/lib/payroll/details";
import { resolvePayRange } from "@/lib/payroll/period";
import { mindbodyServiced, synqiqServiced } from "@/lib/payroll/sessions-serviced";
import { getTrainerPilot } from "@/lib/trainer/pilot";
import { cn } from "@/lib/utils";

type Props = { searchParams: Promise<{ from?: string; to?: string; source?: string }> };

// Club Admin: every session each trainer was paid for in the period -- client,
// date and time, where it fell in the client's package, the session's value,
// the trainer's rate and what they earned -- totalled per trainer. Mindbody's
// appointments are what payroll pays today; the SynqIQ pilot view shows the
// practice pay from sessions closed out on the Trainer Calendar.
export default async function SessionsServicedPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const params = await searchParams;
  const { from, to, presets } = resolvePayRange(params, zone);
  const pilot = await getTrainerPilot(staff.organizationId);
  const source = params.source === "synqiq" && pilot.on ? "synqiq" : "mindbody";
  const local = (iso: string) => DateTime.fromISO(iso).setZone(zone);

  const rows =
    source === "synqiq"
      ? await synqiqServiced(admin, staff.organizationId, from, to)
      : mindbodyServiced((await buildPayroll(staff.organizationId, from, to, admin)).people, (iso) => local(iso).toISODate()!);
  const groups = byPerson(rows).map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => (a.startsAt ?? a.date).localeCompare(b.startsAt ?? b.date)),
  }));
  const grand = groups.reduce((sum, group) => sum + group.totalCents, 0);
  const sessionCount = rows.filter((row) => !row.note?.startsWith("Reversed")).length;

  const tab = (value: "mindbody" | "synqiq", label: string) => (
    <Link
      href={`/dashboard/payroll/sessions?${new URLSearchParams({ from, to, source: value }).toString()}`}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm",
        source === value ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </Link>
  );

  return (
    <DashboardShell
      title="Sessions Serviced"
      description="Every session each trainer was paid for: client, date and time, the session used against the package, the session's value, the rate and the trainer's earning."
    >
      <div className="space-y-6">
        <PayRange path="/dashboard/payroll/sessions" from={from} to={to} presets={presets} extra={{ source }} />

        <div className="flex flex-wrap items-center gap-2">
          {tab("mindbody", "Mindbody (paid today)")}
          {pilot.on ? tab("synqiq", "SynqIQ pilot (practice)") : null}
          <span className="text-sm text-muted-foreground">
            {sessionCount} sessions · {money(grand)}
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyReport>No paid sessions in these dates.</EmptyReport>
        ) : (
          groups.map((group) => (
            <PersonCard
              key={group.staffId}
              staffId={group.staffId}
              name={group.staffName}
              totalCents={group.totalCents}
              summary={`${group.rows.filter((row) => !row.note?.startsWith("Reversed")).length} sessions`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead className="text-right">Session value</TableHead>
                    <TableHead>Session rate</TableHead>
                    <TableHead className="text-right">Earning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => (
                    <TableRow key={row.key} className={row.amountCents < 0 ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-nowrap">{DateTime.fromISO(row.date).toFormat("ccc, LLL d")}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.startsAt ? local(row.startsAt).toFormat("h:mm a") : "—"}</TableCell>
                      <TableCell className="font-medium">{row.client}</TableCell>
                      <TableCell className="text-sm">
                        {row.session}
                        {row.note ? (
                          <Badge variant={row.note.startsWith("Reversed") ? "outline" : "secondary"} className="ml-1">
                            {row.note}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {row.pack ? (
                          <>
                            Session {row.pack.used} of {row.pack.total}
                            <span className="block text-xs text-muted-foreground">
                              {row.pack.left} left{row.packName ? ` · ${row.packName}` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{row.packName ?? "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.valueCents == null ? "—" : money(row.valueCents)}
                        {row.valueEstimated ? <span className="block text-xs text-muted-foreground">usual price</span> : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.rateName ?? <span className="text-destructive">No rate</span>}
                        {row.rateDetail ? <span className="block text-xs text-muted-foreground">{row.rateDetail}</span> : null}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(row.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={7}>Total for {group.staffName}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(group.totalCents)}</TableCell>
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
