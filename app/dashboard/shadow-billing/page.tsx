import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { loadShadowBilling } from "@/lib/memberships/shadow-data";
import type { ComparisonReason } from "@/lib/memberships/shadow-billing";

const REASONS: Record<ComparisonReason, { label: string; explain: string; review: boolean }> = {
  match: { label: "Match", explain: "SynqIQ would charge exactly what Mindbody charges.", review: false },
  frozen_in_mindbody: {
    label: "Frozen in Mindbody",
    explain: "Mindbody skips the charge because the membership is frozen. Mindbody's API doesn't share freeze dates.",
    review: false,
  },
  changed_by_synqiq: {
    label: "Changed by a SynqIQ edit",
    explain: "A credit, discount or freeze made in SynqIQ accounts for the difference.",
    review: false,
  },
  amount_differs: { label: "Amount differs", explain: "Both charge that day, but the totals don't match.", review: true },
  no_scheduled_charge: {
    label: "No charge scheduled in SynqIQ",
    explain: "Mindbody charges this member that day; their imported contracts have nothing scheduled.",
    review: true,
  },
  contract_not_imported: {
    label: "Contract not imported",
    explain: "Mindbody charges a member SynqIQ has no contracts for yet.",
    review: true,
  },
  member_not_matched: {
    label: "Member not matched",
    explain: "The report line couldn't be matched to a Mindbody client by email or name.",
    review: true,
  },
  not_in_mindbody: {
    label: "Not in Mindbody's report",
    explain: "SynqIQ's copy lists a charge Mindbody's report doesn't have that day.",
    review: true,
  },
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const day = (iso: string) => DateTime.fromISO(iso).toFormat("ccc, LLL d");

export default async function ShadowBillingPage() {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const data = await loadShadowBilling(supabase, staff.organizationId, timezone);
  const { summary } = data;
  const review = data.lines.filter((line) => REASONS[line.reason].review);
  const local = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(timezone).toFormat("LLL d, h:mm a") : "never");

  return (
    <DashboardShell
      title="Shadow Billing"
      description="What SynqIQ would charge each member, compared with what Mindbody charges. Mindbody still does the charging until the switch."
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Contracts refreshed from Mindbody {local(data.contractsSyncedAt)} · AutoPay Detail uploaded{" "}
          {local(data.reportUploadedAt)}
          {data.reportRange ? ` (covers ${day(data.reportRange.from)} – ${day(data.reportRange.to)})` : ""}.{" "}
          <Link href="/dashboard/settings/imports" className="underline underline-offset-4">
            Upload a newer report
          </Link>
        </p>

        {!data.window ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Upload Mindbody&apos;s AutoPay Detail report (covering upcoming dates) on{" "}
              <Link href="/dashboard/settings/imports" className="underline underline-offset-4">
                Settings → Imports
              </Link>{" "}
              to compare.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  {day(data.window.from)} – {day(data.window.to)}
                </CardTitle>
                <CardDescription>Totals include tax. Each line is one member&apos;s charges on one day.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Mindbody charges" value={money(summary.mindbodyCents)} />
                <Stat label="SynqIQ would charge" value={money(summary.synqiqCents)} />
                <Stat label="Difference" value={money(summary.synqiqCents - summary.mindbodyCents)} />
                <Stat
                  label="Member-days matching"
                  value={`${(summary.matchRate * 100).toFixed(1)}%`}
                  sub={`${summary.matched.toLocaleString()} of ${summary.compared.toLocaleString()}`}
                />
              </CardContent>
            </Card>

            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>By reason</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Mindbody</TableHead>
                      <TableHead className="text-right">SynqIQ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(Object.keys(REASONS) as ComparisonReason[])
                      .filter((reason) => summary.byReason.has(reason))
                      .map((reason) => {
                        const entry = summary.byReason.get(reason)!;
                        return (
                          <TableRow key={reason}>
                            <TableCell>
                              <span className="font-medium">{REASONS[reason].label}</span>
                              <span className="block text-xs text-muted-foreground">{REASONS[reason].explain}</span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{entry.count.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(entry.mindbodyCents)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(entry.synqiqCents)}</TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </Card>

            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Differences to review ({review.length.toLocaleString()})</CardTitle>
                <CardDescription>Lines that need a look before SynqIQ takes over billing.</CardDescription>
              </CardHeader>
              {review.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing to review.</p>
              ) : (
                <div className="max-h-[32rem] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Member</TableHead>
                        <TableHead className="text-right">Mindbody</TableHead>
                        <TableHead className="text-right">SynqIQ</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {review.slice(0, 500).map((line) => (
                        <TableRow key={line.key}>
                          <TableCell className="whitespace-nowrap">{day(line.date)}</TableCell>
                          <TableCell>
                            {line.clientName ?? (line.mindbodyClientId ? data.namesByClientId.get(line.mindbodyClientId) : null) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{money(line.mindbodyCents)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(line.synqiqCents)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{REASONS[line.reason].label}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </>
        )}

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Planned changes (SynqIQ edits)</CardTitle>
            <CardDescription>
              Credits, discounts and freezes made in SynqIQ. They don&apos;t change what Mindbody charges until the switch.
            </CardDescription>
          </CardHeader>
          {data.adjustments.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No edits yet. Club Admins will add them from a member&apos;s billing tab.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.adjustments.map((adjustment) => (
                    <TableRow key={adjustment.id}>
                      <TableCell>{data.namesByClientId.get(adjustment.mindbodyClientId) ?? "—"}</TableCell>
                      <TableCell>
                        {adjustment.kind === "freeze"
                          ? "Freeze"
                          : adjustment.kind === "credit"
                            ? `Credit ${money(adjustment.amountCents ?? 0)}`
                            : `${adjustment.kind === "discount_once" ? "One-time" : "Ongoing"} discount ${
                                adjustment.percent !== null ? `${adjustment.percent}%` : money(adjustment.amountCents ?? 0)
                              }`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {day(adjustment.startsOn)}
                        {adjustment.endsOn ? ` – ${day(adjustment.endsOn)}` : ""}
                      </TableCell>
                      <TableCell>{adjustment.reason}</TableCell>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
