import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cutoverSettings, payersWithCards } from "@/lib/billing/cutover-job";
import { CardTools, CutoverActions, RowToggle } from "./cutover-actions";

export const metadata: Metadata = { title: "Jan 1 cutover" };
export const dynamic = "force-dynamic";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VIEWS = [
  { key: "needs_card", label: "Needs a card" },
  { key: "has_card", label: "Card ready" },
  { key: "activated", label: "Schedule created" },
  { key: "excluded", label: "Left out" },
  { key: "all", label: "All" },
] as const;

type Row = {
  id: string;
  payer_mindbody_client_id: string;
  payer_name: string | null;
  member_name: string | null;
  member_mindbody_client_id: string;
  contract_name: string;
  bill_day: number | null;
  first_bill_date: string | null;
  total_cents: number | null;
  remaining_payments: number | null;
  auto_renews: boolean;
  status: string;
  excluded_reason: string | null;
};

// Member Billing > Jan 1 cutover (Club Admins): the dry run of moving every
// Mindbody autopay to SynqIQ on each member's own billing day.
export default async function CutoverPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const staff = await requireAccess(isClubAdmin);
  const params = await searchParams;
  const view = VIEWS.some((item) => item.key === params.view) ? (params.view as (typeof VIEWS)[number]["key"]) : "needs_card";
  const q = (params.q ?? "").trim().toLowerCase().slice(0, 60);
  const admin = createSupabaseAdminClient();
  const [settings, cards, { data: org }] = await Promise.all([
    cutoverSettings(admin, staff.organizationId),
    payersWithCards(admin, staff.organizationId),
    admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle(),
  ]);
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("billing_cutover_rows")
      .select(
        "id, payer_mindbody_client_id, payer_name, member_name, member_mindbody_client_id, contract_name, bill_day, first_bill_date, total_cents, remaining_payments, auto_renews, status, excluded_reason",
      )
      .eq("organization_id", staff.organizationId)
      .order("payer_name")
      .range(from, from + 999)
      .returns<Row[]>();
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const when = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy h:mm a") : null);
  const hasCard = (row: Row) => cards.has(row.payer_mindbody_client_id);
  const planned = rows.filter((row) => row.status === "planned");
  const activated = rows.filter((row) => row.status === "activated");
  const billing = [...planned, ...activated];
  const payers = new Set(billing.map((row) => row.payer_mindbody_client_id));
  const payersNeedingCard = new Set(planned.filter((row) => !hasCard(row)).map((row) => row.payer_mindbody_client_id));
  const monthly = billing.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
  const byDay = new Map<number, number>();
  for (const row of billing) if (row.bill_day) byDay.set(row.bill_day, (byDay.get(row.bill_day) ?? 0) + 1);
  const firstMonth = billing.filter(
    (row) => (row.first_bill_date ?? "") < DateTime.fromISO(settings.cutoverDate).plus({ months: 1 }).toISODate()!,
  );

  const shown = rows
    .filter((row) =>
      view === "all"
        ? true
        : view === "needs_card"
          ? row.status === "planned" && !hasCard(row)
          : view === "has_card"
            ? row.status === "planned" && hasCard(row)
            : row.status === view,
    )
    .filter((row) => !q || `${row.payer_name} ${row.member_name} ${row.contract_name}`.toLowerCase().includes(q));

  return (
    <DashboardShell
      title="Jan 1 cutover"
      description="Every Mindbody autopay moving to SynqIQ, each member on their own billing day. A dry run: nothing is charged and nothing changes in Mindbody."
      wide
    >
      <div className="space-y-6">
        <p className="text-sm">
          <Link href="/dashboard/member-billing" className="text-muted-foreground underline underline-offset-4">
            Member Billing
          </Link>
        </p>
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Cutover on {DateTime.fromISO(settings.cutoverDate).toFormat("LLLL d, yyyy")}
              {settings.lockedAt ? <Badge>Locked</Badge> : settings.snapshotAt ? <Badge variant="outline">Not locked</Badge> : null}
            </CardTitle>
            <CardDescription>
              {settings.snapshotAt
                ? `Snapshot from Mindbody taken ${when(settings.snapshotAt)}${settings.lockedAt ? `, locked ${when(settings.lockedAt)}` : ""}.`
                : "No snapshot yet."}{" "}
              SynqIQ takes over every bill due on or after the cutover; Mindbody keeps the ones before.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Take the snapshot and check it (download the CSV to compare with Mindbody&apos;s Autopay Detail report).</li>
              <li>
                <strong>Lock it before ending any autopay contracts in Mindbody.</strong> Once locked, changes in Mindbody don&apos;t affect
                it.
              </li>
              <li>Get cards into Stripe: the Mindbody card export, or members adding a card (app, emailed link, front desk).</li>
              <li>
                Create the schedules. Run it again as more cards come in. Charging starts on each member&apos;s first bill after the
                cutover.
              </li>
            </ol>
            <CutoverActions snapshotTaken={Boolean(settings.snapshotAt)} locked={Boolean(settings.lockedAt)} activated={activated.length} />
          </CardContent>
        </Card>

        {rows.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Getting cards into Stripe</CardTitle>
            </CardHeader>
            <CardContent>
              <CardTools />
            </CardContent>
          </Card>
        ) : null}

        {rows.length ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Contracts moving",
                  value: billing.length.toLocaleString(),
                  note: `${payers.size.toLocaleString()} people paying`,
                },
                { label: "Monthly dues", value: money(monthly), note: `${firstMonth.length} bills in the first month` },
                { label: "Need a card in Stripe", value: payersNeedingCard.size.toLocaleString(), note: "payers with no dues card yet" },
                {
                  label: "Schedules created",
                  value: activated.length.toLocaleString(),
                  note: `${rows.filter((row) => row.status === "excluded").length} left out`,
                },
              ].map((tile) => (
                <Card key={tile.label}>
                  <CardContent className="py-4">
                    <p className="text-sm text-muted-foreground">{tile.label}</p>
                    <p className="text-2xl font-semibold tabular-nums">{tile.value}</p>
                    <p className="text-xs text-muted-foreground">{tile.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bills per day of the month</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex h-28 items-end gap-1">
                  {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                    const count = byDay.get(day) ?? 0;
                    const max = Math.max(1, ...byDay.values());
                    return (
                      <div key={day} className="flex flex-1 flex-col items-center gap-1" title={`Day ${day}: ${count}`}>
                        <div className="w-full rounded-t bg-primary/70" style={{ height: `${(count / max) * 88}px` }} />
                        <span className="text-[9px] text-muted-foreground">{day}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {VIEWS.map((item) => (
                    <Link
                      key={item.key}
                      href={`?view=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                      className={`rounded-full border px-3 py-1 text-sm ${item.key === view ? "border-primary bg-primary-subtle" : "hover:bg-accent"}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
                <form className="flex gap-2">
                  <input type="hidden" name="view" value={view} />
                  <input name="q" defaultValue={q} placeholder="Search name or contract" className="h-9 rounded-md border px-2 text-sm" />
                  <a href="/api/billing/cutover" className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent">
                    Download CSV
                  </a>
                </form>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Payer</th>
                      <th className="px-4 py-2 font-medium">Contract</th>
                      <th className="px-4 py-2 font-medium">Day</th>
                      <th className="px-4 py-2 font-medium">First SynqIQ bill</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Card</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shown.slice(0, 400).map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2">
                          <Link href={`/dashboard/memberships/${row.payer_mindbody_client_id}`} className="font-medium hover:underline">
                            {row.payer_name || row.payer_mindbody_client_id}
                          </Link>
                          {row.member_mindbody_client_id !== row.payer_mindbody_client_id ? (
                            <span className="block text-xs text-muted-foreground">
                              for {row.member_name || row.member_mindbody_client_id}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          {row.contract_name}
                          <span className="block text-xs text-muted-foreground">
                            {row.auto_renews ? "Renews" : row.remaining_payments ? `${row.remaining_payments} payments left` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-2 tabular-nums">{row.bill_day ?? ""}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {row.first_bill_date ? DateTime.fromISO(row.first_bill_date).toFormat("LLL d, yyyy") : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.total_cents == null ? "" : money(row.total_cents)}</td>
                        <td className="px-4 py-2">
                          {hasCard(row) ? <Badge variant="secondary">On file</Badge> : <Badge variant="outline">Needed</Badge>}
                        </td>
                        <td className="px-4 py-2">
                          {row.status === "activated"
                            ? "Schedule created"
                            : row.status === "excluded"
                              ? `Left out: ${row.excluded_reason ?? ""}`
                              : "Planned"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {row.status !== "activated" ? <RowToggle id={row.id} included={row.status === "planned"} /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 400 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    Showing 400 of {shown.length}. Search, or download the CSV for all.
                  </p>
                ) : !shown.length ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">Nothing here.</p>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </DashboardShell>
  );
}
