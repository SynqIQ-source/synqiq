import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { excludedDepartmentIds } from "@/lib/excluded-departments";
import { OverviewRangeSelect } from "./overview-range-select";

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

  const [allRows, allDepartments] = await Promise.all([
    getOverviewRows(supabase, rangeStartDT, rangeEndDT),
    getDepartments(supabase),
  ]);

  // Pool Lanes is excluded from every reporting view except Heat Map -- see
  // lib/excluded-departments.ts. Filtered here, once, before any
  // aggregation, so both the Studio-wide totals and the per-department
  // breakdown stay internally consistent with each other.
  const hiddenDepartmentIds = excludedDepartmentIds(allDepartments);
  const rows = allRows.filter((row) => !row.department_id || !hiddenDepartmentIds.has(row.department_id));
  const departments = allDepartments.filter((department) => !hiddenDepartmentIds.has(department.id));

  const orgSummary = summarize(rows);
  const departmentRows = buildDepartmentRows(rows, departments);

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

  return (
    <DashboardShell
      title="Overview"
      description="Studio health at a glance, based on synced Mindbody class data."
    >
      <OverviewRangeSelect range={range} rangeStart={rangeStart} rangeEnd={rangeEnd} />

      <section className="mt-6">
        <h2 className="text-base font-semibold text-zinc-950">Studio-wide</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Classes" value={orgSummary.totalClasses.toString()} />
          <StatCard
            label="Avg Class Size"
            value={orgSummary.totalClasses > 0 ? orgSummary.avgClassSize.toFixed(1) : "N/A"}
          />
          <StatCard
            label="Fill Rate"
            value={orgSummary.fillRatePct !== null ? `${orgSummary.fillRatePct.toFixed(1)}%` : "N/A"}
          />
          <StatCard
            label="Attendance"
            value={orgSummary.attendancePct !== null ? `${orgSummary.attendancePct.toFixed(1)}%` : "N/A"}
          />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-zinc-950">By Department</h2>
          <p className="text-sm text-zinc-500">
            Sorted by total classes · this period ={" "}
            {range === "all"
              ? "all synced history to date"
              : `${rangeStart} to ${rangeEnd}`}
          </p>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3"></th>
                <th className="border-l p-3 text-left text-xs font-semibold text-zinc-950" colSpan={4}>
                  This period
                </th>
                <th className="border-l p-3 text-left text-xs font-semibold text-zinc-400" colSpan={5}>
                  Client engagement{" "}
                  <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[0.65rem] font-medium normal-case text-zinc-400">
                    Coming soon
                  </span>
                </th>
                <th className="border-l p-3 text-left text-xs font-semibold text-zinc-950" colSpan={3}>
                  Cost
                </th>
              </tr>
              <tr className="border-b text-xs text-zinc-500">
                <th className="p-3 text-left">Department</th>
                <th className="border-l p-3 text-right">Classes</th>
                <th className="p-3 text-right">Avg Size</th>
                <th className="p-3 text-right">Empty</th>
                <th className="p-3 text-right">Fill Rate</th>
                <th className="border-l p-3 text-right">Total Clients</th>
                <th className="p-3 text-right">Unique Clients</th>
                <th className="p-3 text-right">Participation</th>
                <th className="p-3 text-right">Frequency</th>
                <th className="p-3 text-right">Utilization</th>
                <th className="border-l p-3 text-right">Total Spend</th>
                <th className="p-3 text-right">Avg / Class</th>
                <th className="p-3 text-right">vs. Prior Period</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-zinc-50 font-semibold">
                <td className="p-3">All departments</td>
                <td className="border-l p-3 text-right">{orgSummary.totalClasses}</td>
                <td className="p-3 text-right">
                  {orgSummary.totalClasses > 0 ? orgSummary.avgClassSize.toFixed(1) : "N/A"}
                </td>
                <td className="p-3 text-right">{orgSummary.emptyClasses}</td>
                <td className="p-3 text-right">
                  {orgSummary.fillRatePct !== null ? `${orgSummary.fillRatePct.toFixed(1)}%` : "N/A"}
                </td>
                <MockCells count={5} borderLeft />
                <td className="border-l p-3 text-right">
                  {orgSummary.totalClasses > 0 ? formatCurrency(allDepartmentsTotalSpend) : "N/A"}
                </td>
                <td className="p-3 text-right">
                  {allDepartmentsAvgPerClass !== null ? formatCurrencyPerClass(allDepartmentsAvgPerClass) : "N/A"}
                </td>
                <td className="p-3 text-right">{formatVsPrior(allDepartmentsVsPriorPct)}</td>
              </tr>
              {departmentRows.map(({ department, summary }, index) => {
                const cost = departmentCostRows[index];
                return (
                  <tr key={department.id} className="border-b">
                    <td className="p-3 font-medium">{department.name}</td>
                    <td className="border-l p-3 text-right">{summary.totalClasses}</td>
                    <td className="p-3 text-right">
                      {summary.totalClasses > 0 ? summary.avgClassSize.toFixed(1) : "N/A"}
                    </td>
                    <td className="p-3 text-right">{summary.totalClasses > 0 ? summary.emptyClasses : "N/A"}</td>
                    <td className="p-3 text-right">
                      {summary.fillRatePct !== null ? `${summary.fillRatePct.toFixed(1)}%` : "N/A"}
                    </td>
                    <MockCells count={5} />
                    <td className="border-l p-3 text-right">
                      {cost.totalSpend !== null ? formatCurrency(cost.totalSpend) : "N/A"}
                    </td>
                    <td className="p-3 text-right">
                      {cost.avgPerClass !== null ? formatCurrencyPerClass(cost.avgPerClass) : "N/A"}
                    </td>
                    <td className="p-3 text-right">{formatVsPrior(cost.vsPriorPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">
          <span className="font-medium text-zinc-600">This period</span> and{" "}
          <span className="font-medium text-zinc-600">Cost</span> columns are real, computed from
          synced <code>class_occurrences</code> and imported <code>payroll_line_items</code>.{" "}
          <span className="font-medium text-zinc-600">Client engagement</span> columns are still a
          placeholder -- they need the client/membership integration, which isn&apos;t wired up yet.
        </p>
      </section>
    </DashboardShell>
  );
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatCurrencyPerClass(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Plain black text by design, no arrows or red/green -- Cost is a finance
// figure sitting next to the studio-health traffic-light color language used
// elsewhere on this page (e.g. Heat Map), and conflating "cost went up" with
// the same visual severity cue as "fill rate went down" would misrepresent
// it: a cost increase isn't necessarily bad (more classes taught can raise
// both spend and revenue together).
function formatVsPrior(pct: number | null): string {
  if (pct === null) {
    return "N/A";
  }
  const sign = pct < 0 ? "−" : "+";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6">
      <p className="text-sm font-medium text-zinc-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

// Renders `count` placeholder cells for the not-yet-built column groups --
// a real dash, not a fake number, so nobody mistakes these for computed
// values while skimming the table.
function MockCells({ count, borderLeft }: { count: number; borderLeft?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <td
          key={index}
          className={`p-3 text-right italic text-zinc-400 ${borderLeft && index === 0 ? "border-l" : ""}`}
        >
          —
        </td>
      ))}
    </>
  );
}
