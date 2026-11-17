import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { loadClubOverview } from "@/lib/dashboard/club";
import { cn } from "@/lib/utils";
import { ClubDrillDown, DRILL_VIEWS, type DrillView } from "./drill-downs";

// Club Overview (Club Admins): the whole club at a glance, from SynqIQ's own
// records (lib/dashboard/club.ts). Each card opens its details below the
// cards (?view=...). Before payments go live, "Include practice data" counts
// practice sales, memberships and autopays so the page can be tried out.

export const dynamic = "force-dynamic";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d");

function Delta({
  diff,
  percent,
  format = String,
  against,
}: {
  diff: number;
  percent: number | null;
  format?: (n: number) => string;
  against: string;
}) {
  const tone = diff > 0 ? "text-emerald-700 dark:text-emerald-400" : diff < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
  const sign = diff > 0 ? "▲ " : diff < 0 ? "▼ " : "";
  return (
    <p className="text-xs text-muted-foreground">
      <span className={cn("font-medium", tone)}>
        {sign}
        {format(Math.abs(diff))}
        {percent != null && diff !== 0 ? ` (${Math.abs(percent)}%)` : ""}
      </span>{" "}
      {diff === 0 ? "no change " : ""}vs {against}
    </p>
  );
}

function Card({
  label,
  value,
  children,
  view,
  current,
  practice,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
  view?: DrillView;
  current: DrillView | null;
  practice: boolean;
}) {
  const body = (
    <>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </>
  );
  const className = cn(
    "rounded-xl border bg-card p-4",
    view && "block transition-colors hover:border-primary hover:bg-primary/5",
    view && current === view && "border-primary ring-1 ring-primary",
  );
  if (!view) return <div className={className}>{body}</div>;
  const params = new URLSearchParams();
  if (current !== view) params.set("view", view);
  if (practice) params.set("practice", "1");
  const query = params.toString();
  return (
    <Link href={query ? `/dashboard/club?${query}` : "/dashboard/club"} scroll={false} className={className}>
      {body}
    </Link>
  );
}

export default async function ClubOverviewPage({ searchParams }: { searchParams: Promise<{ view?: string; practice?: string }> }) {
  const staff = await requireAccess(isClubAdmin);
  const params = await searchParams;
  const practice = params.practice === "1";
  const view = (DRILL_VIEWS as readonly string[]).includes(params.view ?? "") ? (params.view as DrillView) : null;
  const data = await loadClubOverview(staff.organizationId, { includePractice: practice });
  const { periods } = data;
  const lastMonth = `${day(periods.priorFrom)}–${day(periods.priorTo)}`;
  const toggle = new URLSearchParams();
  if (view) toggle.set("view", view);
  if (!practice) toggle.set("practice", "1");

  return (
    <DashboardShell
      title="Club Overview"
      description={`${DateTime.fromISO(periods.today).toFormat("cccc, LLLL d")} · month to date from SynqIQ's own records`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={toggle.toString() ? `/dashboard/club?${toggle}` : "/dashboard/club"}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1",
              practice ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "text-muted-foreground",
            )}
          >
            <span className={cn("size-2 rounded-full", practice ? "bg-amber-500" : "bg-muted-foreground/40")} />
            {practice ? "Including practice data" : "Include practice data"}
          </Link>
          <span className="text-xs text-muted-foreground">
            {practice
              ? "Practice sales, memberships and autopays are counted, so you can try the dashboard before payments go live."
              : "Real sales and payments only. Until payments go live, most sales still happen in Mindbody."}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card label="Active members" value={data.members.active.toLocaleString()} view="members" current={view} practice={practice}>
            <Delta diff={data.members.vs30.diff} percent={data.members.vs30.percent} against="30 days ago" />
            {data.members.frozen ? <p className="text-xs text-muted-foreground">{data.members.frozen} frozen (not counted)</p> : null}
          </Card>
          <Card label="Sales MTD" value={money(data.sales.mtdCents)} view="sales" current={view} practice={practice}>
            <Delta diff={data.sales.vsPrior.diff} percent={data.sales.vsPrior.percent} format={money} against={lastMonth} />
          </Card>
          <Card label="Check-ins MTD" value={data.checkIns.mtd.toLocaleString()} view="checkins" current={view} practice={practice}>
            <Delta diff={data.checkIns.vsPrior.diff} percent={data.checkIns.vsPrior.percent} against={lastMonth} />
            <p className="text-xs text-muted-foreground">Front desk only</p>
          </Card>
          <Card label="Today's revenue" value={money(data.revenueToday.totalCents)} view="sales" current={view} practice={practice}>
            <p className="text-xs text-muted-foreground">
              Checkout {money(data.revenueToday.posCents)} · Autopays {money(data.revenueToday.autopayCents)}
            </p>
          </Card>
          <Card label="Guests MTD" value={data.guests.mtd.toLocaleString()} view="guests" current={view} practice={practice}>
            <Delta diff={data.guests.vsPrior.diff} percent={data.guests.vsPrior.percent} against={lastMonth} />
          </Card>
          <Card
            label="Maintenance"
            view="maintenance"
            current={view}
            practice={practice}
            value={
              <div className="flex items-end gap-5">
                <span>
                  {data.maintenance.downNew}
                  <span className="block text-xs font-normal text-muted-foreground">Down / new</span>
                </span>
                <span>
                  {data.maintenance.downInProgress}
                  <span className="block text-xs font-normal text-muted-foreground">Down / in progress</span>
                </span>
                <span>
                  {data.maintenance.avgDaysDown ?? "—"}
                  <span className="block text-xs font-normal text-muted-foreground">Avg days down</span>
                </span>
              </div>
            }
          />
        </div>

        {view ? <ClubDrillDown view={view} data={data} /> : <p className="text-sm text-muted-foreground">Click a card for the details.</p>}
      </div>
    </DashboardShell>
  );
}
