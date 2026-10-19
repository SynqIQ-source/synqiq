import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { excludedDepartmentIds } from "@/lib/excluded-departments";
import { OverviewRangeSelect } from "./overview-range-select";
import {
  DepartmentFillRateChart,
  WeeklyFillRateChart,
  type DepartmentPoint,
  type WeeklyPoint,
} from "./overview-charts";
import { CalendarCheck, Gauge, UserCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type OverviewRow = {
  id: string;
  department_id: string | null;
  staff_id: string | null;
  start_datetime: string | null;
  class_name: string | null;
  max_capacity: number | null;
  total_signed_in: number | null;
  total_booked: number | null;
};

type Department = { id: string; name: string };

const PAGE_SIZE = 1000;
const RANGE_PRESET_DAYS: Record<string, number> = { "30": 30, "60": 60, "90": 90 };

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

// This project's PostgREST max-rows is 1000 (confirmed empirically, same
// caveat as the Classes page's historical fetch) -- a plain unbounded
// .select() silently truncates past that. There are more occurred classes
// than that today, so this has to paginate.
async function getOverviewRows(
  supabase: ScopedSupabaseClient,
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null,
) {
  const allRows: OverviewRow[] = [];
  let offset = 0;

  for (;;) {
    let query = supabase
      .from("class_occurrences")
      .select("id, department_id, staff_id, start_datetime, class_name, max_capacity, total_signed_in, total_booked")
      // The pre-redesign rows never captured an occurrence id -- exclude
      // them rather than let stale/ambiguous data skew the aggregates.
      // Attendance counts are only meaningful for classes that have already
      // happened, so every metric on this page (including "Total classes")
      // shares that same scope for internal consistency -- a raw
      // synced-class count next to attendance figures computed from a
      // different scope would be confusing, not just inconsistent.
      .not("mindbody_occurrence_id", "is", null)
      .lte("start_datetime", new Date().toISOString());

    if (rangeStart) {
      query = query.gte("start_datetime", rangeStart.toUTC().toISO() ?? "");
    }
    if (rangeEnd) {
      query = query.lte("start_datetime", rangeEnd.toUTC().toISO() ?? "");
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1).returns<OverviewRow[]>();

    if (error) {
      throw new Error(`Failed to load overview metrics: ${error.message}`);
    }

    allRows.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return allRows;
}

type ResolvedRange = { range: string; rangeStart: string; rangeEnd: string };

// Mirrors app/dashboard/instructors/page.tsx's resolveRange, plus a "ytd"
// preset -- see overview-range-select.tsx for why Overview has one and
// Instructors doesn't. Default stays "all" so an existing bookmark/link with
// no range param keeps showing the same all-synced-history view as before
// this selector existed.
function resolveRange(
  params: { range?: string; rangeStart?: string; rangeEnd?: string },
  timezone: string,
): ResolvedRange {
  if (params.range === "custom" && params.rangeStart && params.rangeEnd) {
    return { range: "custom", rangeStart: params.rangeStart, rangeEnd: params.rangeEnd };
  }

  if (params.range === "ytd") {
    const now = DateTime.now().setZone(timezone);
    const start = now.startOf("year");
    return { range: "ytd", rangeStart: start.toISODate() ?? "", rangeEnd: now.toISODate() ?? "" };
  }

  if (params.range && RANGE_PRESET_DAYS[params.range]) {
    const now = DateTime.now().setZone(timezone);
    const start = now.minus({ days: RANGE_PRESET_DAYS[params.range] });
    return { range: params.range, rangeStart: start.toISODate() ?? "", rangeEnd: now.toISODate() ?? "" };
  }

  return { range: "all", rangeStart: "", rangeEnd: "" };
}

type PriorWindow = { start: DateTime; end: DateTime };

// The immediately-preceding period of equal length -- same shifting-window
// idea as Heat Map's week-over-week comparison
// (app/dashboard/heatmap/page.tsx's resolveComparisonWindow), generalized
// from a fixed week to whatever length "This period" currently is (a 30/60/
// 90-day preset, YTD, or a custom range). "All synced history" has no
// rangeStart to shift back from, so it has no well-defined prior window --
// every vs-Prior-Period figure is N/A in that case, not a guess.
function resolvePriorWindow(range: string, rangeStart: string, rangeEnd: string, timezone: string): PriorWindow | null {
  if (range === "all") {
    return null;
  }

  const startDate = DateTime.fromISO(rangeStart, { zone: timezone }).startOf("day");
  const endDate = DateTime.fromISO(rangeEnd, { zone: timezone }).startOf("day");
  const inclusiveDays = Math.round(endDate.diff(startDate, "days").days) + 1;

  const priorEndDate = startDate.minus({ days: 1 });
  const priorStartDate = priorEndDate.minus({ days: inclusiveDays - 1 });

  return { start: priorStartDate.startOf("day"), end: priorEndDate.endOf("day") };
}

async function getDepartments(supabase: ScopedSupabaseClient): Promise<Department[]> {
  const { data, error } = await supabase.from("departments").select("id, name");

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  return data ?? [];
}

type PayrollCostRow = { staff_id: string | null; earnings_amt: number; class_date: string | null; class_name: string };

// payroll_line_items has no department column (see
// supabase/migrations/20260807180000_payroll_line_items_columns.sql) -- Cost
// attribution instead matches each payroll row to the specific class
// occurrence it paid for, via (staff_id, local class date, class name), and
// attributes the earnings to that occurrence's own department. See
// buildPayrollByKey/sumMatchedPayroll below.
//
// An earlier version of this attributed an instructor's ENTIRE payroll for
// the period to every department they taught in at all -- confirmed wrong
// against this org's real data (e.g. an instructor who also teaches
// Reformer Pilates had that pay counted toward Cycling too, inflating
// Cycling's Avg/Class well past its real flat per-class rate). Matching by
// the actual class instance fixes that; the tradeoff is the opposite
// failure mode -- a payroll row whose class name doesn't exactly match the
// synced Mindbody occurrence (sub, reschedule, naming drift) goes
// unmatched and is undercounted rather than misattributed. Verified
// against a real payroll import: ~98% of dated rows matched.
//
// Personal Training/Hourly Pay rows collapse to a single lump row per
// instructor per pay period with class_date null (expected, not missing --
// see the migration above) -- there's no class to match those to, so they
// never contribute to any department's Total Spend, regardless of range.
async function getPayrollRows(
  supabase: ScopedSupabaseClient,
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null,
): Promise<PayrollCostRow[]> {
  const allRows: PayrollCostRow[] = [];
  let offset = 0;

  for (;;) {
    let query = supabase.from("payroll_line_items").select("staff_id, earnings_amt, class_date, class_name");

    if (rangeStart && rangeEnd) {
      query = query.gte("class_date", rangeStart.toISODate() ?? "").lte("class_date", rangeEnd.toISODate() ?? "");
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1).returns<PayrollCostRow[]>();

    if (error) {
      throw new Error(`Failed to load payroll cost data: ${error.message}`);
    }

    allRows.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return allRows;
}

type VisitRow = { clientMindbodyUniqueId: number; departmentId: string | null };

type RawVisitRow = {
  client_mindbody_unique_id: number;
  class_occurrences: { department_id: string | null; start_datetime: string | null } | null;
};

// class_visits has no department/date column of its own by design (see
// supabase/migrations/20260826120000_clients_and_class_visits.sql) --
// department comes from the occurrence it's for, so the period filter has
// to apply to the embedded class_occurrences relation, not this table.
// `!inner` makes it an actual join rather than a left-join-with-nulls, so
// the date filter genuinely restricts which rows come back.
//
// signed_in = true only -- a no-show shouldn't count as "engagement," same
// convention as every other real number on this page already using
// total_signed_in rather than total_booked.
async function getClassVisits(
  supabase: ScopedSupabaseClient,
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null,
): Promise<VisitRow[]> {
  const allRows: VisitRow[] = [];
  let offset = 0;

  for (;;) {
    let query = supabase
      .from("class_visits")
      .select("client_mindbody_unique_id, class_occurrences!inner(department_id, start_datetime)")
      .eq("signed_in", true);

    if (rangeStart) {
      query = query.gte("class_occurrences.start_datetime", rangeStart.toUTC().toISO() ?? "");
    }
    if (rangeEnd) {
      query = query.lte("class_occurrences.start_datetime", rangeEnd.toUTC().toISO() ?? "");
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1).returns<RawVisitRow[]>();

    if (error) {
      throw new Error(`Failed to load class visits: ${error.message}`);
    }

    for (const row of data ?? []) {
      allRows.push({
        clientMindbodyUniqueId: row.client_mindbody_unique_id,
        departmentId: row.class_occurrences?.department_id ?? null,
      });
    }

    if (!data || data.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return allRows;
}

// Total Members -- Participation's denominator, and (via the id set) the
// filter for its numerator too. A studio-wide figure, not per-department
// (MindBody memberships aren't scoped to a single class category), and
// independent of the selected date range -- it's "how many active members
// do we have right now," not "how many were active at some point during
// the period." Status = 'Active' is the only value that means a real
// current paying member -- see the clients table's migration comment for
// the other five observed values and why the separate `Active` boolean
// field isn't used.
//
// Returns the id set, not just a count -- Participation needs to filter
// *which* visiting clients count toward its numerator (see
// summarizeClientEngagement), not just know the denominator.
async function getActiveMemberIds(supabase: ScopedSupabaseClient): Promise<Set<number>> {
  const allIds: number[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("clients")
      .select("mindbody_unique_id")
      .eq("status", "Active")
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<{ mindbody_unique_id: number }[]>();

    if (error) {
      throw new Error(`Failed to load active member ids: ${error.message}`);
    }

    allIds.push(...(data ?? []).map((row) => row.mindbody_unique_id));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return new Set(allIds);
}

function groupVisitsByDepartment(visits: VisitRow[]): Map<string, VisitRow[]> {
  const rowsByDepartment = new Map<string, VisitRow[]>();
  for (const visit of visits) {
    if (!visit.departmentId) {
      continue;
    }
    const list = rowsByDepartment.get(visit.departmentId) ?? [];
    list.push(visit);
    rowsByDepartment.set(visit.departmentId, list);
  }
  return rowsByDepartment;
}

type ClientEngagementSummary = {
  totalClients: number;
  uniqueClients: number;
  participationPct: number | null;
  frequency: number | null;
};

function summarizeClientEngagement(
  visits: VisitRow[],
  activeMemberIds: Set<number>,
): ClientEngagementSummary {
  const totalClients = visits.length;
  // Total Clients/Unique Clients/Frequency count every real visitor
  // (members, drop-ins, trial/guest visits, anyone with a Non-Member/
  // Expired/Suspended/Declined/Terminated status) -- that's genuine
  // attendance and worth showing as-is. Participation is different: it's
  // specifically "what fraction of our active membership base uses this
  // department," so mixing in non-members inflates it against a
  // denominator that excludes them. Confirmed empirically for Membership
  // GX Classes -- 21 of 183 unique visitors (11.5%) weren't Active status,
  // overstating Participation 18.2% vs. the correct 16.1%.
  const uniqueClients = new Set(visits.map((visit) => visit.clientMindbodyUniqueId)).size;
  const uniqueActiveClients = new Set(
    visits.filter((visit) => activeMemberIds.has(visit.clientMindbodyUniqueId)).map((visit) => visit.clientMindbodyUniqueId),
  ).size;

  return {
    totalClients,
    uniqueClients,
    participationPct: activeMemberIds.size > 0 ? (uniqueActiveClients / activeMemberIds.size) * 100 : null,
    // Undefined, not a real zero, when nobody attended -- same convention
    // as avgPerClass. 0 unique clients over 0 visits is "no data," not "0
    // visits per client."
    frequency: uniqueClients > 0 ? totalClients / uniqueClients : null,
  };
}

type MetricsSummary = {
  totalClasses: number;
  avgClassSize: number;
  emptyClasses: number;
  fillRatePct: number | null;
  attendancePct: number | null;
};

// True aggregates (sum / sum), not a mean of each class's own percentage --
// same fix as the Classes page's historical-average column, for the same
// reason: averaging percentages directly lets small-capacity outliers
// dominate far more than their actual attendance volume warrants.
function summarize(rows: OverviewRow[]): MetricsSummary {
  const totalClasses = rows.length;
  let signedInSum = 0;
  let capacitySum = 0;
  let bookedSum = 0;
  let emptyClasses = 0;

  for (const row of rows) {
    const signedIn = row.total_signed_in ?? 0;
    signedInSum += signedIn;
    capacitySum += row.max_capacity ?? 0;
    bookedSum += row.total_booked ?? 0;
    if (signedIn === 0) {
      emptyClasses += 1;
    }
  }

  return {
    totalClasses,
    avgClassSize: totalClasses > 0 ? signedInSum / totalClasses : 0,
    emptyClasses,
    fillRatePct: capacitySum > 0 ? (signedInSum / capacitySum) * 100 : null,
    attendancePct: bookedSum > 0 ? (signedInSum / bookedSum) * 100 : null,
  };
}

type DepartmentRow = { department: Department; summary: MetricsSummary };

// Pulled out of buildDepartmentRows so Cost attribution (which needs each
// department's raw staff_id set, not just the aggregated summary) can reuse
// the same grouping against both the current and prior period's occurrence
// rows.
function groupByDepartment(rows: OverviewRow[]): Map<string, OverviewRow[]> {
  const rowsByDepartment = new Map<string, OverviewRow[]>();
  for (const row of rows) {
    if (!row.department_id) {
      continue;
    }
    const list = rowsByDepartment.get(row.department_id) ?? [];
    list.push(row);
    rowsByDepartment.set(row.department_id, list);
  }
  return rowsByDepartment;
}

// Identifies one specific class instance -- the join key between a payroll
// row and the class_occurrence it paid for. class_date is a plain date (no
// timezone) as MindBody's payroll export reports it, so the occurrence side
// has to be converted to the org's local calendar date, not compared as a
// UTC timestamp, or every occurrence whose UTC date rolls over near
// midnight local time would silently fail to match.
function classInstanceKey(staffId: string, localDate: string, className: string): string {
  return `${staffId}|${localDate}|${className.trim().toLowerCase()}`;
}

// staff_id/class_date-less (Personal Training/Hourly Pay lump) rows can't
// be tied to a key at all and are dropped here -- see getPayrollRows.
function buildPayrollByKey(payrollRows: PayrollCostRow[]): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const row of payrollRows) {
    if (!row.staff_id || !row.class_date) {
      continue;
    }
    const key = classInstanceKey(row.staff_id, row.class_date, row.class_name);
    byKey.set(key, (byKey.get(key) ?? 0) + row.earnings_amt);
  }
  return byKey;
}

// Sums the payroll matched to this scope's (a department, for the period)
// own occurrences, one payroll row's earnings counted at most once per
// distinct class instance even if two occurrences coincidentally share a
// key (e.g. the same class taught twice in one day) -- see
// classInstanceKey/getPayrollRows for what "matched" means and its
// tradeoffs.
function sumMatchedPayroll(occRows: OverviewRow[], payrollByKey: Map<string, number>, timezone: string): number {
  const countedKeys = new Set<string>();
  let total = 0;

  for (const row of occRows) {
    if (!row.staff_id || !row.start_datetime || !row.class_name) {
      continue;
    }
    const localDate = DateTime.fromISO(row.start_datetime, { zone: "utc" }).setZone(timezone).toISODate();
    if (!localDate) {
      continue;
    }
    const key = classInstanceKey(row.staff_id, localDate, row.class_name);
    if (countedKeys.has(key)) {
      continue;
    }
    countedKeys.add(key);
    total += payrollByKey.get(key) ?? 0;
  }

  return total;
}

// Undefined (not a real zero) when there were no classes to divide by --
// same N/A convention the other This-period columns already use for a
// zero-class row, rather than a misleading "$0.00/class".
function avgPerClass(totalSpend: number, classesCount: number): number | null {
  return classesCount > 0 ? totalSpend / classesCount : null;
}

function vsPriorPercent(currentAvg: number | null, priorAvg: number | null): number | null {
  if (currentAvg === null || priorAvg === null || priorAvg === 0) {
    return null;
  }
  return ((currentAvg - priorAvg) / priorAvg) * 100;
}

type DepartmentCostRow = {
  department: Department;
  totalSpend: number | null;
  avgPerClass: number | null;
  vsPriorPct: number | null;
  priorTotalSpend: number | null;
  priorClassesCount: number;
};

// Every real department shows a row, including ones with zero occurrences
// in scope (e.g. no classes have happened there yet) -- a department
// silently missing from the report reads as "this department doesn't
// exist" rather than "this department has no activity," which is the wrong
// signal for a manager scanning for underused departments. Rows with an
// unresolved department_id aren't attributable to any single department
// row, but are still counted in the Studio-wide/"All departments" totals
// above, same as today.
function buildDepartmentRows(rows: OverviewRow[], departments: Department[]): DepartmentRow[] {
  const rowsByDepartment = groupByDepartment(rows);

  return departments
    .map((department) => ({
      department,
      summary: summarize(rowsByDepartment.get(department.id) ?? []),
    }))
    .sort((a, b) => b.summary.totalClasses - a.summary.totalClasses);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; rangeStart?: string; rangeEnd?: string }>;
}) {
  const params = await searchParams;

  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on class_occurrences/departments are the actual enforcement.
  // No session -> the admin client, same as before.
  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  const { range, rangeStart, rangeEnd } = resolveRange(params, timezone);
  const rangeStartDT = range === "all" ? null : DateTime.fromISO(rangeStart, { zone: timezone }).startOf("day");
  const rangeEndDT = range === "all" ? null : DateTime.fromISO(rangeEnd, { zone: timezone }).endOf("day");

  const [allRows, allDepartments, allVisits, activeMemberIds] = await Promise.all([
    getOverviewRows(supabase, rangeStartDT, rangeEndDT),
    getDepartments(supabase),
    getClassVisits(supabase, rangeStartDT, rangeEndDT),
    getActiveMemberIds(supabase),
  ]);

  // Pool Lanes is excluded from every reporting view except Heat Map -- see
  // lib/excluded-departments.ts. Filtered here, once, before any
  // aggregation, so both the Studio-wide totals and the per-department
  // breakdown stay internally consistent with each other.
  const hiddenDepartmentIds = excludedDepartmentIds(allDepartments);
  const rows = allRows.filter((row) => !row.department_id || !hiddenDepartmentIds.has(row.department_id));
  const departments = allDepartments.filter((department) => !hiddenDepartmentIds.has(department.id));
  const visits = allVisits.filter((visit) => !visit.departmentId || !hiddenDepartmentIds.has(visit.departmentId));

  const orgSummary = summarize(rows);
  const departmentRows = buildDepartmentRows(rows, departments);

  // Computed directly from the whole (hidden-department-filtered) visits
  // list, not summed from the department rows below -- unlike Cost, a
  // client visiting more than one department is a real, common case here
  // (per-class-instance attribution has no analogous overlap problem, but
  // a person is still one person across departments), so "All departments"
  // Unique Clients has to be a true distinct count, not a sum that would
  // double-count them.
  const orgClientEngagement = summarizeClientEngagement(visits, activeMemberIds);
  const visitsByDept = groupVisitsByDepartment(visits);

  const priorWindow = resolvePriorWindow(range, rangeStart, rangeEnd, timezone);

  const [currentPayrollRows, priorAllRows, priorPayrollRows] = await Promise.all([
    getPayrollRows(supabase, rangeStartDT, rangeEndDT),
    priorWindow ? getOverviewRows(supabase, priorWindow.start, priorWindow.end) : Promise.resolve<OverviewRow[]>([]),
    priorWindow ? getPayrollRows(supabase, priorWindow.start, priorWindow.end) : Promise.resolve<PayrollCostRow[]>([]),
  ]);

  const priorRows = priorAllRows.filter((row) => !row.department_id || !hiddenDepartmentIds.has(row.department_id));
  const currentOccByDept = groupByDepartment(rows);
  const priorOccByDept = groupByDepartment(priorRows);
  const currentPayrollByKey = buildPayrollByKey(currentPayrollRows);
  const priorPayrollByKey = buildPayrollByKey(priorPayrollRows);

  // Cost columns for each real department row, built alongside (not inside)
  // buildDepartmentRows/summarize -- Cost needs the raw per-department
  // occurrence rows and a second (prior-period) query, neither of which the
  // This-period aggregates above need.
  const departmentCostRows: DepartmentCostRow[] = departmentRows.map(({ department, summary }) => {
    if (summary.totalClasses === 0) {
      return {
        department,
        totalSpend: null,
        avgPerClass: null,
        vsPriorPct: null,
        priorTotalSpend: null,
        priorClassesCount: 0,
      };
    }

    const totalSpend = sumMatchedPayroll(currentOccByDept.get(department.id) ?? [], currentPayrollByKey, timezone);
    const currentAvg = avgPerClass(totalSpend, summary.totalClasses);

    let priorTotalSpend: number | null = null;
    let priorClassesCount = 0;
    let vsPriorPct: number | null = null;

    if (priorWindow) {
      const priorOccRows = priorOccByDept.get(department.id) ?? [];
      priorClassesCount = priorOccRows.length;
      priorTotalSpend = sumMatchedPayroll(priorOccRows, priorPayrollByKey, timezone);
      vsPriorPct = vsPriorPercent(currentAvg, avgPerClass(priorTotalSpend, priorClassesCount));
    }

    return { department, totalSpend, avgPerClass: currentAvg, vsPriorPct, priorTotalSpend, priorClassesCount };
  });

  // "All departments" Total Spend is the sum of the department rows above.
  // Unlike an instructor-level attribution, a specific class instance can
  // only ever belong to one department, so this is now effectively also the
  // true org-wide total (no double-counting to reconcile away).
  const allDepartmentsTotalSpend = departmentCostRows.reduce((sum, row) => sum + (row.totalSpend ?? 0), 0);
  const allDepartmentsAvgPerClass = avgPerClass(allDepartmentsTotalSpend, orgSummary.totalClasses);

  let allDepartmentsVsPriorPct: number | null = null;
  if (priorWindow) {
    const priorTotalClasses = departmentCostRows.reduce((sum, row) => sum + row.priorClassesCount, 0);
    const priorTotalSpendSum = departmentCostRows.reduce((sum, row) => sum + (row.priorTotalSpend ?? 0), 0);
    allDepartmentsVsPriorPct = vsPriorPercent(allDepartmentsAvgPerClass, avgPerClass(priorTotalSpendSum, priorTotalClasses));
  }

  // Same zero-classes-in-scope -> N/A convention as Cost -- a department
  // with no classes this period has no meaningful engagement figures
  // either, matching how Online Group Fitness already reads elsewhere in
  // this table.
  const departmentClientRows = departmentRows.map(({ department, summary }) => {
    if (summary.totalClasses === 0) {
      return { department, totalClients: null, uniqueClients: null, participationPct: null, frequency: null };
    }
    const { totalClients, uniqueClients, participationPct, frequency } = summarizeClientEngagement(
      visitsByDept.get(department.id) ?? [],
      activeMemberIds,
    );
    return { department, totalClients, uniqueClients, participationPct, frequency };
  });

  const weeklyTrend = buildWeeklyTrend(rows, timezone, range === "all" ? 26 : null);
  const departmentChartData: DepartmentPoint[] = departmentRows
    .filter(({ summary }) => summary.totalClasses > 0 && summary.fillRatePct !== null)
    .map(({ department, summary }) => ({
      department: department.name,
      fillRate: Number((summary.fillRatePct ?? 0).toFixed(1)),
      classes: summary.totalClasses,
    }))
    .sort((a, b) => b.fillRate - a.fillRate);

  const periodLabel = range === "all" ? "All synced history" : `${formatDate(rangeStart)} – ${formatDate(rangeEnd)}`;
  const hasClasses = orgSummary.totalClasses > 0;

  return (
    <DashboardShell
      title="Overview"
      description="Studio health at a glance, from your synced Mindbody classes."
      actions={<OverviewRangeSelect range={range} rangeStart={rangeStart} rangeEnd={rangeEnd} />}
    >
      <div className="flex flex-col gap-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={CalendarCheck}
            label="Classes held"
            value={orgSummary.totalClasses.toLocaleString()}
            detail={hasClasses ? `${orgSummary.emptyClasses.toLocaleString()} had no one check in` : periodLabel}
          />
          <KpiCard
            icon={Users}
            label="Avg class size"
            value={hasClasses ? orgSummary.avgClassSize.toFixed(1) : "—"}
            detail="checked-in clients per class"
          />
          <KpiCard
            icon={Gauge}
            label="Fill rate"
            value={formatPercent(orgSummary.fillRatePct)}
            detail="of class capacity used"
          />
          <KpiCard
            icon={UserCheck}
            label="Attendance"
            value={formatPercent(orgSummary.attendancePct)}
            detail="of bookings that checked in"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Fill rate by week</CardTitle>
              <CardDescription>{range === "all" ? "Last 26 weeks of synced history" : periodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyTrend.length > 1 ? (
                <WeeklyFillRateChart data={weeklyTrend} />
              ) : (
                <EmptyState text="Not enough weeks in this period to show a trend." />
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Fill rate by department</CardTitle>
              <CardDescription>{periodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {departmentChartData.length > 0 ? (
                <DepartmentFillRateChart data={departmentChartData} />
              ) : (
                <EmptyState text="No classes in this period yet." />
              )}
            </CardContent>
          </Card>
        </section>

        <Card>
          <Tabs defaultValue="classes" className="gap-4">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>By department</CardTitle>
                <CardDescription>{periodLabel} · sorted by classes held</CardDescription>
              </div>
              <TabsList>
                <TabsTrigger value="classes">Classes</TabsTrigger>
                <TabsTrigger value="clients">Clients</TabsTrigger>
                <TabsTrigger value="cost">Cost</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="classes">
                <DepartmentTable
                  columns={["Classes", "Avg size", "Empty", "Fill rate"]}
                  total={[
                    orgSummary.totalClasses.toLocaleString(),
                    hasClasses ? orgSummary.avgClassSize.toFixed(1) : "—",
                    orgSummary.emptyClasses.toLocaleString(),
                    formatPercent(orgSummary.fillRatePct),
                  ]}
                  rows={departmentRows.map(({ department, summary }) => ({
                    id: department.id,
                    name: department.name,
                    inactive: summary.totalClasses === 0,
                    cells: [
                      summary.totalClasses.toLocaleString(),
                      summary.totalClasses > 0 ? summary.avgClassSize.toFixed(1) : "—",
                      summary.totalClasses > 0 ? summary.emptyClasses.toLocaleString() : "—",
                      formatPercent(summary.fillRatePct),
                    ],
                  }))}
                  footnote="Empty = classes where no one checked in. Fill rate = checked-in clients ÷ class capacity."
                />
              </TabsContent>
              <TabsContent value="clients">
                <DepartmentTable
                  columns={["Visits", "Unique clients", "Participation", "Visits / client"]}
                  total={[
                    hasClasses ? orgClientEngagement.totalClients.toLocaleString() : "—",
                    hasClasses ? orgClientEngagement.uniqueClients.toLocaleString() : "—",
                    formatPercent(orgClientEngagement.participationPct),
                    orgClientEngagement.frequency !== null ? orgClientEngagement.frequency.toFixed(1) : "—",
                  ]}
                  rows={departmentRows.map(({ department, summary }, index) => {
                    const engagement = departmentClientRows[index];
                    return {
                      id: department.id,
                      name: department.name,
                      inactive: summary.totalClasses === 0,
                      cells: [
                        engagement.totalClients?.toLocaleString() ?? "—",
                        engagement.uniqueClients?.toLocaleString() ?? "—",
                        formatPercent(engagement.participationPct),
                        engagement.frequency !== null ? engagement.frequency.toFixed(1) : "—",
                      ],
                    };
                  })}
                  footnote="Participation = share of active members who took at least one class in the department. Visits / client = visits ÷ unique clients."
                />
              </TabsContent>
              <TabsContent value="cost">
                <DepartmentTable
                  columns={["Instructor pay", "Per class", "vs. prior period"]}
                  total={[
                    hasClasses ? formatCurrency(allDepartmentsTotalSpend) : "—",
                    allDepartmentsAvgPerClass !== null ? formatCurrencyPerClass(allDepartmentsAvgPerClass) : "—",
                    formatVsPrior(allDepartmentsVsPriorPct),
                  ]}
                  rows={departmentRows.map(({ department, summary }, index) => {
                    const cost = departmentCostRows[index];
                    return {
                      id: department.id,
                      name: department.name,
                      inactive: summary.totalClasses === 0,
                      cells: [
                        cost.totalSpend !== null ? formatCurrency(cost.totalSpend) : "—",
                        cost.avgPerClass !== null ? formatCurrencyPerClass(cost.avgPerClass) : "—",
                        formatVsPrior(cost.vsPriorPct),
                      ],
                    };
                  })}
                  footnote={
                    range === "all"
                      ? "From imported payroll, matched to each class taught. Pick a time frame to compare against the prior period."
                      : "From imported payroll, matched to each class taught. Compared with the same-length period just before."
                  }
                />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </DashboardShell>
  );
}

// Weekly fill rate (sum signed-in / sum capacity, the same true-aggregate
// rule as summarize()) bucketed by org-local week start. maxWeeks trims the
// "All synced history" view to recent weeks so the chart stays readable.
// The current, still-in-progress week is left out: check-ins sync
// overnight, so today's already-finished classes still show 0 signed in and
// would drag that week's point toward 0%.
function buildWeeklyTrend(rows: OverviewRow[], timezone: string, maxWeeks: number | null): WeeklyPoint[] {
  const byWeek = new Map<string, { signedIn: number; capacity: number; classes: number }>();
  const currentWeekStart = DateTime.now().setZone(timezone).startOf("week").toISODate() ?? "";

  for (const row of rows) {
    if (!row.start_datetime) {
      continue;
    }
    const weekStart = DateTime.fromISO(row.start_datetime, { zone: "utc" }).setZone(timezone).startOf("week").toISODate();
    if (!weekStart || weekStart >= currentWeekStart) {
      continue;
    }
    const bucket = byWeek.get(weekStart) ?? { signedIn: 0, capacity: 0, classes: 0 };
    bucket.signedIn += row.total_signed_in ?? 0;
    bucket.capacity += row.max_capacity ?? 0;
    bucket.classes += 1;
    byWeek.set(weekStart, bucket);
  }

  const weeks = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b));
  const trimmed = maxWeeks ? weeks.slice(-maxWeeks) : weeks;

  return trimmed.map(([weekStart, bucket]) => ({
    week: DateTime.fromISO(weekStart).toFormat("LLL d"),
    fillRate: bucket.capacity > 0 ? Number(((bucket.signedIn / bucket.capacity) * 100).toFixed(1)) : null,
    classes: bucket.classes,
  }));
}

function formatDate(isoDate: string): string {
  const parsed = DateTime.fromISO(isoDate);
  return parsed.isValid ? parsed.toFormat("LLL d, yyyy") : isoDate;
}

function formatPercent(value: number | null): string {
  return value !== null ? `${value.toFixed(1)}%` : "—";
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatCurrencyPerClass(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Plain text by design, no arrows or red/green -- Cost is a finance figure,
// and a cost increase isn't necessarily bad (more classes taught can raise
// both spend and revenue together), so it shouldn't borrow the same
// severity cue as "fill rate went down".
function formatVsPrior(pct: number | null): string {
  if (pct === null) {
    return "—";
  }
  const sign = pct < 0 ? "−" : "+";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  );
}

type DepartmentTableRow = { id: string; name: string; inactive: boolean; cells: string[] };

function DepartmentTable({
  columns,
  total,
  rows,
  footnote,
}: {
  columns: string[];
  total: string[];
  rows: DepartmentTableRow[];
  footnote?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-4">Department</TableHead>
              {columns.map((column) => (
                <TableHead key={column} className="text-right last:pr-4">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={row.inactive ? "text-muted-foreground" : undefined}>
                <TableCell className="pl-4 font-medium">
                  <span className="flex items-center gap-2">
                    {row.name}
                    {row.inactive ? (
                      <Badge variant="outline" className="font-normal">
                        No classes
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                {row.cells.map((cell, index) => (
                  <TableCell key={columns[index]} className="text-right tabular-nums last:pr-4">
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4 font-semibold">All departments</TableCell>
              {total.map((cell, index) => (
                <TableCell key={columns[index]} className="text-right font-semibold tabular-nums last:pr-4">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {footnote ? <p className="text-xs leading-5 text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}
