import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin, isTrainerAccess } from "@/lib/permissions";
import { loadFitnessDashboard } from "@/lib/dashboard/fitness";
import { percentOf } from "@/lib/dashboard/fitness-math";
import { cn } from "@/lib/utils";
import { FITNESS_VIEWS, FitnessDrillDown, type FitnessView } from "./drill-downs";

// Fitness Dashboard: personal training at a glance, from SynqIQ's own
// records (lib/dashboard/fitness.ts). Club Admins see the cards; each opens
// its details below (?view=...). Trainers see the links to their pages.

export const dynamic = "force-dynamic";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const pct = (value: number | null) => (value == null ? "—" : `${value}%`);

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
  view: FitnessView;
  current: FitnessView | null;
  practice: boolean;
}) {
  const params = new URLSearchParams();
  if (current !== view) params.set("view", view);
  if (practice) params.set("practice", "1");
  const query = params.toString();
  return (
    <Link
      href={query ? `/dashboard/fitness?${query}` : "/dashboard/fitness"}
      scroll={false}
      className={cn(
        "block rounded-xl border bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5",
        current === view && "border-primary ring-1 ring-primary",
      )}
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">{children}</div>
    </Link>
  );
}

function Split({ items }: { items: { value: React.ReactNode; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
      {items.map((item) => (
        <span key={item.label}>
          {item.value}
          <span className="block text-xs font-normal text-muted-foreground">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function PageLinks() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Link href="/dashboard/sales/new-members" className="rounded-xl border bg-card p-4 hover:border-primary">
        <p className="font-medium">New Members</p>
        <p className="text-sm text-muted-foreground">New members, their trainer and intro session.</p>
      </Link>
      <Link href="/dashboard/trainer-health" className="rounded-xl border bg-card p-4 hover:border-primary">
        <p className="font-medium">Trainer Health</p>
        <p className="text-sm text-muted-foreground">Each trainer&apos;s clients, sessions and packs.</p>
      </Link>
    </div>
  );
}

export default async function FitnessDashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; practice?: string }> }) {
  const staff = await requireAccess(isTrainerAccess);
  if (!isClubAdmin(staff)) {
    return (
      <DashboardShell title="Fitness Dashboard" description="Personal training pages.">
        <PageLinks />
      </DashboardShell>
    );
  }
  const params = await searchParams;
  const practice = params.practice === "1";
  const view = (FITNESS_VIEWS as readonly string[]).includes(params.view ?? "") ? (params.view as FitnessView) : null;
  const data = await loadFitnessDashboard(staff.organizationId, { includePractice: practice });
  const toggle = new URLSearchParams();
  if (view) toggle.set("view", view);
  if (!practice) toggle.set("practice", "1");
  const { goals, trainers } = data;

  return (
    <DashboardShell
      title="Fitness Dashboard"
      description={`${DateTime.fromISO(data.periods.today).toFormat("cccc, LLLL d")} · personal training, month to date, from SynqIQ's own records`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={toggle.toString() ? `/dashboard/fitness?${toggle}` : "/dashboard/fitness"}
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
              ? "Practice PT sales are counted, so you can try the dashboard before payments go live."
              : "Real sales only. Until payments go live, PT is still sold and booked in Mindbody."}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card label="PT revenue MTD" value={money(data.sales.totalCents)} view="sales" current={view} practice={practice}>
            <p>
              Avg session rate sold:{" "}
              <span className="font-medium text-foreground">
                {data.sales.avgSessionCents == null ? "—" : money(data.sales.avgSessionCents)}
              </span>
            </p>
            <p>Trainers and sales team</p>
          </Card>
          <Card
            label="Sessions MTD"
            view="sessions"
            current={view}
            practice={practice}
            value={
              <Split
                items={[
                  { value: data.sessions.scheduled, label: "Scheduled" },
                  { value: data.sessions.completed, label: "Completed" },
                  { value: pct(data.sessions.percent), label: "Completed %" },
                ]}
              />
            }
          />
          <Card label="Intro workouts · next 7 days" value={data.intros.length} view="intros" current={view} practice={practice}>
            <p>Booked through {DateTime.fromISO(data.weekEnd).toFormat("ccc LLL d")}</p>
          </Card>
          <Card
            label="Goals and pace"
            view="goals"
            current={view}
            practice={practice}
            value={
              <Split
                items={[
                  {
                    value: `${goals.sessions.actual}${goals.sessions.goal != null ? ` / ${goals.sessions.goal}` : ""}`,
                    label: "Sessions serviced / goal",
                  },
                  {
                    value: `${money(goals.sales.actual)}${goals.sales.goal != null ? ` / ${money(goals.sales.goal)}` : ""}`,
                    label: "PT sales / goal",
                  },
                ]}
              />
            }
          >
            <p>
              On pace for <span className="font-medium text-foreground">{goals.sessions.projected}</span> sessions
              {goals.sessions.goal ? ` (${pct(percentOf(goals.sessions.projected, goals.sessions.goal))})` : ""} and{" "}
              <span className="font-medium text-foreground">{money(goals.sales.projected)}</span>
              {goals.sales.goal ? ` (${pct(percentOf(goals.sales.projected, goals.sales.goal))})` : ""}
            </p>
            {goals.sessions.goal == null && goals.sales.goal == null ? <p>No goals set yet. Open to set them.</p> : null}
          </Card>
          <Card
            label="Average per trainer"
            view="trainers"
            current={view}
            practice={practice}
            value={
              <Split
                items={[
                  { value: trainers.averages.sessions ?? "—", label: "Sessions serviced" },
                  {
                    value: trainers.averages.salesCents == null ? "—" : money(trainers.averages.salesCents),
                    label: "PT sales",
                  },
                ]}
              />
            }
          >
            <p>
              Mean across {trainers.averages.trainers} trainer{trainers.averages.trainers === 1 ? "" : "s"} active this month
            </p>
          </Card>
        </div>

        {view ? (
          <FitnessDrillDown view={view} data={data} canSetGoals />
        ) : (
          <p className="text-sm text-muted-foreground">Click a card for the details.</p>
        )}

        <PageLinks />
      </div>
    </DashboardShell>
  );
}
