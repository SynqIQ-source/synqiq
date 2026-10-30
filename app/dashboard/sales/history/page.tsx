import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeFunnel, type Funnel } from "@/lib/crm/funnel";
import { allTargetRows, formatKpi, KPI_METRICS, monthKey, targetsForMonth, type Targets } from "@/lib/crm/kpis";
import { isLeadType, LEAD_TYPES } from "@/lib/crm/labels";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cn } from "@/lib/utils";
import { HistoryFilters } from "./history-filters";

export const dynamic = "force-dynamic";

const MONTH_COUNTS = [6, 12, 24] as const;

// The columns, left to right. Each is a KPI from lib/crm/kpis.ts, so it can
// show that month's target under the actual.
const COLUMNS = [
  "leads",
  "contacted",
  "appointments",
  "shows",
  "show_rate",
  "walk_ins",
  "guests",
  "returning",
  "total_guests",
  "enrolled",
  "total_close_rate",
  "calls",
  "texts",
  "emails",
] as const;

const HEADINGS: Record<(typeof COLUMNS)[number], string> = {
  leads: "New leads",
  contacted: "Contacted",
  appointments: "Appts",
  shows: "Shows",
  show_rate: "Show %",
  walk_ins: "Walk-ins",
  guests: "Guests",
  returning: "Returning",
  total_guests: "Total guests",
  enrolled: "Enrolled",
  total_close_rate: "Closing %",
  calls: "Calls",
  texts: "Texts",
  emails: "Emails",
};

type MonthRow = {
  key: string;
  label: string;
  partial: boolean;
  funnel: Funnel;
  targets: Targets | null;
};

function sumFunnels(funnels: Funnel[]): Funnel {
  const add = (pick: (f: Funnel) => number) => funnels.reduce((sum, f) => sum + pick(f), 0);
  return {
    walkIns: {
      total: add((f) => f.walkIns.total),
      closed: add((f) => f.walkIns.closed),
    },
    guestsOfMembers: {
      total: add((f) => f.guestsOfMembers.total),
      closed: add((f) => f.guestsOfMembers.closed),
    },
    returning: {
      total: add((f) => f.returning.total),
      closed: add((f) => f.returning.closed),
    },
    leads: {
      total: add((f) => f.leads.total),
      contacted: add((f) => f.leads.contacted),
      appointments: add((f) => f.leads.appointments),
      shows: add((f) => f.leads.shows),
      closed: add((f) => f.leads.closed),
    },
    leadSources: [],
    activity: {
      calls: add((f) => f.activity.calls),
      texts: add((f) => f.activity.texts),
      emails: add((f) => f.activity.emails),
    },
    appointments: {
      scheduled: add((f) => f.appointments.scheduled),
      showed: add((f) => f.appointments.showed),
      closed: add((f) => f.appointments.closed),
    },
    appointmentsMade: add((f) => f.appointmentsMade),
    totals: {
      guests: add((f) => f.totals.guests),
      enrolled: add((f) => f.totals.enrolled),
    },
  };
}

// Sales History: the Sales dashboard's numbers month by month, with each
// month's targets, plus a monthly average of the completed months -- the
// base for forecasting. Admins see the club or one salesperson; salespeople
// only their own.
export default async function SalesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string; seller?: string; type?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  const isAdmin = staff.role === "admin";
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const now = DateTime.now().setZone(org.timezone);

  const monthCount = MONTH_COUNTS.find((count) => String(count) === params.months) ?? 12;
  const sellerParam = isAdmin ? (params.seller ?? "all") : staff.id;
  const staffId = sellerParam === "all" ? null : sellerParam;
  const leadType = isLeadType(params.type) ? params.type : null;

  const [{ data: staffRows }, { data: firstContact }, targetRows] = await Promise.all([
    supabase.from("staff").select("id, display_name, can_sell, role, archived_at").order("display_name"),
    supabase.from("crm_contacts").select("created_at").order("created_at").limit(1).maybeSingle(),
    leadType ? Promise.resolve([]) : allTargetRows(supabase),
  ]);
  const salespeople = (staffRows ?? [])
    .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
    .map((member) => ({
      id: member.id as string,
      name: member.display_name as string,
    }));

  // Months from when the CRM started (first guest entered), up to the chosen
  // number, newest first.
  const firstMonth = firstContact
    ? DateTime.fromISO(firstContact.created_at).setZone(org.timezone).startOf("month")
    : now.startOf("month");
  const months: DateTime[] = [];
  for (let index = 0; index < monthCount; index += 1) {
    const month = now.startOf("month").minus({ months: index });
    if (month < firstMonth) break;
    months.push(month);
  }

  const rows: MonthRow[] = await Promise.all(
    months.map(async (month) => {
      const partial = month.hasSame(now, "month");
      const end = partial ? now.endOf("day") : month.endOf("month");
      const funnel = await computeFunnel(supabase, {
        fromIso: month.toUTC().toISO()!,
        toIso: end.toUTC().toISO()!,
        staffId,
        leadType,
      });
      return {
        key: monthKey(month),
        label: month.toFormat("LLL yyyy"),
        partial,
        funnel,
        targets: leadType ? null : targetsForMonth(targetRows, monthKey(month), staffId),
      };
    }),
  );

  const complete = rows.filter((row) => !row.partial);
  const average = complete.length > 0 ? sumFunnels(complete.map((row) => row.funnel)) : null;
  // Average target per metric over the full months that had one.
  const averageTargets: Targets = new Map();
  for (const column of COLUMNS) {
    const set = complete.map((row) => row.targets?.get(column)).filter((value) => value !== undefined);
    if (set.length > 0) averageTargets.set(column, set.reduce((sum, value) => sum + value, 0) / set.length);
  }
  const showTargets = !leadType;

  const who = staffId
    ? (salespeople.find((person) => person.id === staffId)?.name ?? staff.displayName)
    : "The whole club";
  const typeLabel = LEAD_TYPES.find((type) => type.value === leadType)?.label;

  // One metric's cells for a row: Target and Actual side by side (just
  // Actual while narrowed to a lead type). Under the actual: how far above
  // or below target -- or, for the month in progress, how far along.
  const cells = (
    column: (typeof COLUMNS)[number],
    funnel: Funnel,
    targets: Targets | null,
    options: { divideBy?: number; partial?: boolean } = {},
  ) => {
    const metric = KPI_METRICS.get(column)!;
    const raw = metric.actual(funnel);
    const actual = raw === null ? null : metric.kind === "count" ? raw / (options.divideBy ?? 1) : raw;
    const target = targets?.get(column);
    let note: { text: string; tone: "good" | "bad" | "neutral" } | null = null;
    if (target !== undefined && actual !== null) {
      if (options.partial && metric.kind === "count") {
        note = target > 0 ? { text: `${Math.round((actual / target) * 100)}% so far`, tone: "neutral" } : null;
      } else {
        const diff = actual - target;
        const unit = metric.kind === "percent" ? " pts" : "";
        const amount = formatKpi(Math.abs(diff), "count");
        note = {
          text: diff === 0 ? "On target" : `${diff > 0 ? "+" : "−"}${amount}${unit}`,
          tone: options.partial ? "neutral" : diff >= 0 ? "good" : "bad",
        };
      }
    }
    return [
      showTargets ? (
        <TableCell key={`${column}-target`} className="border-l text-right text-muted-foreground tabular-nums">
          {target !== undefined ? formatKpi(target, metric.kind) : "—"}
        </TableCell>
      ) : null,
      <TableCell key={column} className={cn("text-right tabular-nums", !showTargets && "border-l")}>
        <span className="font-medium">{formatKpi(actual, metric.kind)}</span>
        {note ? (
          <span
            className={cn(
              "block text-xs whitespace-nowrap",
              note.tone === "good" && "text-emerald-700",
              note.tone === "bad" && "text-red-600",
              note.tone === "neutral" && "text-muted-foreground",
            )}
          >
            {note.text}
          </span>
        ) : null}
      </TableCell>,
    ];
  };

  return (
    <DashboardShell
      title="Sales History"
      description={`${who}${typeLabel ? ` · ${typeLabel} leads` : ""} · month by month`}
      actions={
        <HistoryFilters
          months={String(monthCount)}
          seller={sellerParam}
          leadType={leadType ?? "all"}
          salespeople={isAdmin ? salespeople : null}
        />
      }
    >
      <div className="space-y-4">
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Monthly results</CardTitle>
            <CardDescription>
              Each month counted the same way as the Sales dashboard.{" "}
              {leadType
                ? "Targets are hidden while narrowed to one lead type."
                : "Each measure shows the month's target next to what actually happened, with the difference underneath (green = met, red = missed)."}
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={showTargets ? 2 : 1} className="align-bottom">
                    Month
                  </TableHead>
                  {COLUMNS.map((column) => (
                    <TableHead
                      key={column}
                      colSpan={showTargets ? 2 : 1}
                      className={cn("border-l whitespace-nowrap", showTargets ? "text-center" : "text-right")}
                    >
                      {HEADINGS[column]}
                    </TableHead>
                  ))}
                </TableRow>
                {showTargets ? (
                  <TableRow>
                    {COLUMNS.flatMap((column) => [
                      <TableHead key={`${column}-t`} className="h-8 border-l text-right text-xs font-normal">
                        Target
                      </TableHead>,
                      <TableHead key={`${column}-a`} className="h-8 text-right text-xs font-normal">
                        Actual
                      </TableHead>,
                    ])}
                  </TableRow>
                ) : null}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {row.label}
                      {row.partial ? (
                        <span className="block text-xs font-normal text-muted-foreground">to date</span>
                      ) : null}
                    </TableCell>
                    {COLUMNS.flatMap((column) => cells(column, row.funnel, row.targets, { partial: row.partial }))}
                  </TableRow>
                ))}
                {average ? (
                  <TableRow className="bg-muted/40">
                    <TableCell className="font-medium whitespace-nowrap">
                      Monthly average
                      <span className="block text-xs font-normal text-muted-foreground">
                        {complete.length} full month
                        {complete.length === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    {COLUMNS.flatMap((column) => cells(column, average, averageTargets, { divideBy: complete.length }))}
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>
        <p className="text-xs text-muted-foreground">
          Months start when the first guest was entered in SynqIQ. The monthly average leaves out the current month
          because it isn&apos;t finished. Percentages in the average are worked out from the combined totals, and its
          targets are the average of the months that had one.
        </p>
      </div>
    </DashboardShell>
  );
}
