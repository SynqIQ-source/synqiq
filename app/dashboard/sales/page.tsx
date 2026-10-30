import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { overdueBySeller } from "@/lib/crm/follow-ups";
import { computeFunnel, percent, type Funnel } from "@/lib/crm/funnel";
import { effectiveTargets, formatKpi, KPI_SECTIONS, monthKey, type Targets } from "@/lib/crm/kpis";
import { isLeadType, LEAD_TYPES } from "@/lib/crm/labels";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cn } from "@/lib/utils";
import { SalesFilters } from "./sales-filters";

export const dynamic = "force-dynamic";

const PRESETS = ["mtd", "today", "7", "last_month", "custom"] as const;
type Preset = (typeof PRESETS)[number];
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function Stat({
  label,
  value,
  sub,
  highlight,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  // Drill-down: the guests behind the number.
  href?: string;
}) {
  const className = cn(
    "rounded-lg border p-3",
    highlight ? "border-primary/40 bg-primary/5" : "bg-card",
    href && "block transition-colors hover:border-primary hover:bg-primary/10",
  );
  const body = (
    <>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

type TargetRow = { label: string; target: string; actual: string; progress: number | null };

// The "Monthly target" column on the left of a section.
function TargetColumn({ rows, monthLabel, isAdmin }: { rows: TargetRow[]; monthLabel: string; isAdmin: boolean }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3 sm:w-56 sm:shrink-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Target · {monthLabel}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No targets set.{" "}
          {isAdmin ? (
            <Link href="/dashboard/settings/sales-targets" className="text-primary underline-offset-4 hover:underline">
              Set targets
            </Link>
          ) : null}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-semibold tabular-nums">{row.target}</span>
              </div>
              {row.progress !== null ? (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn("h-full rounded-full", row.progress >= 100 ? "bg-emerald-600" : "bg-primary")}
                    style={{ width: `${Math.min(100, row.progress)}%` }}
                  />
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground tabular-nums">
                Now {row.actual}
                {row.progress !== null ? ` · ${Math.round(row.progress)}% of target` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  target,
  children,
}: {
  title: string;
  description: React.ReactNode;
  target?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {target}
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{children}</div>
      </CardContent>
    </Card>
  );
}

// Sales dashboard: the guest-to-member funnel for the period (month to date
// by default). Admins see the whole club and can pick one salesperson;
// salespeople only ever see their own guests. Anyone can narrow it to one
// lead type (walk-in, guest of member, referral, phone-in, web).
export default async function SalesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string; seller?: string; type?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  const isAdmin = staff.role === "admin";
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const now = DateTime.now().setZone(org.timezone);

  let preset: Preset = PRESETS.includes(params.range as Preset) ? (params.range as Preset) : "mtd";
  let from = now.startOf("month");
  let to = now.endOf("day");
  if (preset === "today") from = now.startOf("day");
  if (preset === "7") from = now.minus({ days: 6 }).startOf("day");
  if (preset === "last_month") {
    from = now.minus({ months: 1 }).startOf("month");
    to = now.minus({ months: 1 }).endOf("month");
  }
  const startParam = params.start && DATE_PARAM.test(params.start) ? params.start : from.toISODate()!;
  const endParam = params.end && DATE_PARAM.test(params.end) ? params.end : to.toISODate()!;
  if (preset === "custom") {
    const customFrom = DateTime.fromISO(startParam, { zone: org.timezone }).startOf("day");
    const customTo = DateTime.fromISO(endParam, { zone: org.timezone }).endOf("day");
    if (customFrom.isValid && customTo.isValid && customFrom <= customTo) {
      from = customFrom;
      to = customTo;
    } else {
      preset = "mtd";
    }
  }
  const fromIso = from.toUTC().toISO()!;
  const toIso = to.toUTC().toISO()!;

  // Salespeople only see their own numbers, whatever the URL says.
  const sellerParam = isAdmin ? (params.seller ?? "all") : staff.id;
  const staffId = sellerParam === "all" ? null : sellerParam;
  const leadType = isLeadType(params.type) ? params.type : null;

  const { data: staffRows } = await supabase
    .from("staff")
    .select("id, display_name, can_sell, role, archived_at")
    .order("display_name");
  const salespeople = (staffRows ?? [])
    .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
    .map((member) => ({ id: member.id, name: member.display_name as string }));

  const [funnel, followUps] = await Promise.all([
    computeFunnel(supabase, { fromIso, toIso, staffId, leadType }),
    // Follow-ups are a right-now count, not tied to the period.
    overdueBySeller(supabase, org.timezone, staffId),
  ]);
  const sum = (counts: Map<string, number>) => [...counts.values()].reduce((total, value) => total + value, 0);

  // Club view: the same numbers per salesperson, for comparison.
  let bySeller: { id: string; name: string; funnel: Funnel }[] = [];
  if (isAdmin && !staffId) {
    bySeller = await Promise.all(
      salespeople.map(async (person) => ({
        ...person,
        funnel: await computeFunnel(supabase, { fromIso, toIso, staffId: person.id, leadType }),
      })),
    );
    bySeller = bySeller.filter(
      (row) =>
        row.funnel.totals.guests > 0 ||
        row.funnel.leads.total > 0 ||
        (followUps.overdue.get(row.id) ?? 0) > 0 ||
        row.funnel.activity.calls + row.funnel.activity.texts + row.funnel.activity.emails > 0,
    );
  }

  const periodLabel = `${from.toFormat("LLL d")} – ${to.toFormat("LLL d, yyyy")}`;
  const who = staffId
    ? (salespeople.find((person) => person.id === staffId)?.name ?? staff.displayName)
    : "The whole club";
  const typeLabel = LEAD_TYPES.find((type) => type.value === leadType)?.label;
  const { walkIns, guestsOfMembers, returning, leads, leadSources, activity, appointments, appointmentsMade, totals } =
    funnel;
  // Drill-down links keep the dashboard's period and filters.
  const detailsHref = (metric: string) => {
    const query = new URLSearchParams({ metric, range: preset });
    if (preset === "custom") {
      query.set("start", startParam);
      query.set("end", endParam);
    }
    if (isAdmin && staffId) query.set("seller", staffId);
    if (leadType) query.set("type", leadType);
    return `/dashboard/sales/details?${query.toString()}`;
  };

  // Monthly targets for the month the period ends in, for the club or the
  // salesperson shown. Targets cover all lead types, so they're hidden while
  // the dashboard is narrowed to one.
  const targetMonthLabel = to.toFormat("LLL yyyy");
  const targets: Targets | null = leadType
    ? null
    : (await effectiveTargets(supabase, { month: monthKey(to), staffId })).targets;
  const targetColumn = (sectionKey: string) => {
    if (!targets) return undefined;
    const section = KPI_SECTIONS.find((item) => item.key === sectionKey)!;
    const rows: TargetRow[] = section.metrics
      .filter((metric) => targets.has(metric.key))
      .map((metric) => {
        const target = targets.get(metric.key)!;
        const actual = metric.actual(funnel);
        return {
          label: metric.label,
          target: formatKpi(target, metric.kind),
          actual: formatKpi(actual, metric.kind),
          progress: metric.kind === "count" && target > 0 && actual !== null ? (actual / target) * 100 : null,
        };
      });
    return <TargetColumn rows={rows} monthLabel={targetMonthLabel} isAdmin={isAdmin} />;
  };

  return (
    <DashboardShell
      title="Sales"
      description={`${who}${typeLabel ? ` · ${typeLabel} leads` : ""} · ${periodLabel}`}
      actions={
        <SalesFilters
          range={preset}
          start={preset === "custom" ? startParam : from.toISODate()!}
          end={preset === "custom" ? endParam : to.toISODate()!}
          seller={sellerParam}
          leadType={leadType ?? "all"}
          salespeople={isAdmin ? salespeople : null}
        />
      }
    >
      <div className="space-y-6">
        <Section
          title="Walk-ins"
          description="New guests who walked in interested in a membership or pass."
          target={targetColumn("walk_ins")}
        >
          <Stat label="Walk-ins" value={String(walkIns.total)} href={detailsHref("walk_ins")} />
          <Stat label="Closed" value={String(walkIns.closed)} href={detailsHref("walk_ins_closed")} />
          <Stat
            label="Closing %"
            value={percent(walkIns.closed, walkIns.total)}
            href={detailsHref("walk_ins_closed")}
            highlight
          />
        </Section>

        <Section
          title="Guests of members"
          description="New guests who came in with a friend who's a member."
          target={targetColumn("guests")}
        >
          <Stat label="Guests" value={String(guestsOfMembers.total)} href={detailsHref("guests")} />
          <Stat label="Closed" value={String(guestsOfMembers.closed)} href={detailsHref("guests_closed")} />
          <Stat
            label="Closing %"
            value={percent(guestsOfMembers.closed, guestsOfMembers.total)}
            href={detailsHref("guests_closed")}
            highlight
          />
        </Section>

        <Section
          title="Returning guests"
          description="People first entered before this period who came back or bought during it."
          target={targetColumn("returning")}
        >
          <Stat label="Returning" value={String(returning.total)} href={detailsHref("returning")} />
          <Stat label="Closed" value={String(returning.closed)} href={detailsHref("returning_closed")} />
          <Stat
            label="Closing %"
            value={percent(returning.closed, returning.total)}
            href={detailsHref("returning_closed")}
            highlight
          />
        </Section>

        <Section
          title="New leads"
          description="Only people first entered during this period (walk-ins, guests of members, phone-in, web and more): how many have been contacted and how many booked an appointment."
          target={targetColumn("leads")}
        >
          <Stat label="New leads" value={String(leads.total)} href={detailsHref("leads")} highlight />
          <Stat
            label="Contacted"
            value={String(leads.contacted)}
            sub={`${percent(leads.contacted, leads.total)} of leads`}
            href={detailsHref("leads_contacted")}
          />
          <Stat
            label="Appointments made"
            value={String(leads.appointments)}
            sub={`${percent(leads.appointments, leads.total)} conversion`}
            href={detailsHref("leads_appointments")}
          />
        </Section>

        <Section
          title="Appointments"
          target={targetColumn("appointments")}
          description={
            <>
              Appointments set for this period (not canceled), how many showed, and how many of those bought. Click a
              number to see who, or{" "}
              <Link href="/dashboard/sales/calendar" className="text-primary underline-offset-4 hover:underline">
                open the calendar
              </Link>
              .
            </>
          }
        >
          <Stat label="Scheduled" value={String(appointments.scheduled)} href={detailsHref("appointments_scheduled")} />
          <Stat
            label="Showed"
            value={String(appointments.showed)}
            sub={`${percent(appointments.showed, appointments.scheduled)} show rate`}
            href={detailsHref("appointments_showed")}
          />
          <Stat
            label="Closed"
            value={String(appointments.closed)}
            sub={`${percent(appointments.closed, appointments.showed)} of shows`}
            href={detailsHref("appointments_closed")}
            highlight
          />
        </Section>

        <Section
          title="Leads by marketing source"
          description="Total leads this period, broken down by how they heard about us. Guests can pick more than one answer, so the sources can add up to more than the total."
        >
          <Stat label="Total leads" value={String(leads.total)} href={detailsHref("leads")} highlight />
          {leadSources.map((source) => (
            <Stat
              key={source.label}
              label={source.label}
              value={String(source.count)}
              sub={`${percent(source.count, leads.total)} of leads`}
              href={detailsHref(`source:${source.label}`)}
            />
          ))}
        </Section>

        <Section
          title="Contacts"
          description={
            staffId
              ? "Calls logged, texts and emails sent by this salesperson during this period. Click a number to see who."
              : "Calls logged, texts and emails sent by the sales team during this period. Click a number to see who."
          }
          target={targetColumn("contacts")}
        >
          <Stat label="Calls" value={String(activity.calls)} href={detailsHref("calls")} />
          <Stat label="Texts" value={String(activity.texts)} href={detailsHref("texts")} />
          <Stat label="Emails" value={String(activity.emails)} href={detailsHref("emails")} />
          <Stat
            label="Total contacts"
            value={String(activity.calls + activity.texts + activity.emails)}
            href={detailsHref("contacts")}
            highlight
          />
        </Section>

        <Section
          title="Appointments made"
          description={
            staffId
              ? "Appointments this salesperson booked during this period (not canceled). Click to see who."
              : "Appointments the sales team booked during this period (not canceled). Click to see who."
          }
        >
          <Stat label="Appointments made" value={String(appointmentsMade)} href={detailsHref("appointments_made")} highlight />
        </Section>

        <Card>
          <CardHeader>
            <CardTitle>Follow-ups</CardTitle>
            <CardDescription>
              Right now, whatever the period: open leads whose follow-up has passed its due day with no text, email or
              call.{" "}
              <Link href="/dashboard/sales/follow-ups" className="text-primary underline-offset-4 hover:underline">
                See the list
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat
              label="Overdue"
              value={String(sum(followUps.overdue))}
              href={`/dashboard/sales/follow-ups${isAdmin && staffId ? `?seller=${staffId}` : ""}`}
              highlight
            />
            <Stat
              label="Due today"
              value={String(sum(followUps.dueToday))}
              href={`/dashboard/sales/follow-ups?view=today${isAdmin && staffId ? `&seller=${staffId}` : ""}`}
            />
          </CardContent>
        </Card>

        <Section
          title="Total"
          description="Everyone who came in: walk-ins, guests of members, appointment shows and returning guests."
          target={targetColumn("total")}
        >
          <Stat label="Total guests" value={String(totals.guests)} href={detailsHref("total_guests")} />
          <Stat label="Enrolled" value={String(totals.enrolled)} href={detailsHref("enrolled")} />
          <Stat
            label="Closing %"
            value={percent(totals.enrolled, totals.guests)}
            href={detailsHref("enrolled")}
            highlight
          />
        </Section>

        {bySeller.length > 0 ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>By salesperson</CardTitle>
              <CardDescription>Based on each guest&apos;s assigned salesperson.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Guests</TableHead>
                  <TableHead className="text-right">Enrolled</TableHead>
                  <TableHead className="text-right">Closing %</TableHead>
                  <TableHead className="text-right">New leads</TableHead>
                  <TableHead className="text-right">Appts</TableHead>
                  <TableHead className="text-right">Shows</TableHead>
                  <TableHead className="text-right">Show %</TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                  <TableHead className="text-right">Overdue now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySeller.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.funnel.totals.guests}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.funnel.totals.enrolled}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(row.funnel.totals.enrolled, row.funnel.totals.guests)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.funnel.leads.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.funnel.leads.appointments}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.funnel.appointments.showed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(row.funnel.appointments.showed, row.funnel.appointments.scheduled)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.funnel.activity.calls + row.funnel.activity.texts + row.funnel.activity.emails}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        (followUps.overdue.get(row.id) ?? 0) > 0 && "font-semibold text-destructive",
                      )}
                    >
                      {followUps.overdue.get(row.id) ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : null}

        <p className="text-xs text-muted-foreground">
          &ldquo;Closed&rdquo; and &ldquo;Enrolled&rdquo; count sales made during this period, whether staff marked
          them sold or Mindbody shows them as a new active member (updated overnight). Someone who toured in an earlier
          period and buys now counts here as a returning guest.
        </p>
      </div>
    </DashboardShell>
  );
}
