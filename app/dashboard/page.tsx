import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";

type OverviewRow = {
  id: string;
  department_id: string | null;
  max_capacity: number | null;
  total_signed_in: number | null;
  total_booked: number | null;
};

type Department = { id: string; name: string };

const PAGE_SIZE = 1000;

// This project's PostgREST max-rows is 1000 (confirmed empirically, same
// caveat as the Classes page's historical fetch) -- a plain unbounded
// .select() silently truncates past that. There are more occurred classes
// than that today, so this has to paginate.
async function getOverviewRows(supabase: ScopedSupabaseClient) {
  const allRows: OverviewRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("class_occurrences")
      .select("id, department_id, max_capacity, total_signed_in, total_booked")
      // The pre-redesign rows never captured an occurrence id -- exclude
      // them rather than let stale/ambiguous data skew the aggregates.
      // Attendance counts are only meaningful for classes that have already
      // happened, so every metric on this page (including "Total classes")
      // shares that same scope for internal consistency -- a raw
      // synced-class count next to attendance figures computed from a
      // different scope would be confusing, not just inconsistent.
      .not("mindbody_occurrence_id", "is", null)
      .lte("start_datetime", new Date().toISOString())
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<OverviewRow[]>();

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

async function getDepartments(supabase: ScopedSupabaseClient): Promise<Department[]> {
  const { data, error } = await supabase.from("departments").select("id, name");

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  return data ?? [];
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

// Every real department shows a row, including ones with zero occurrences
// in scope (e.g. no classes have happened there yet) -- a department
// silently missing from the report reads as "this department doesn't
// exist" rather than "this department has no activity," which is the wrong
// signal for a manager scanning for underused departments. Rows with an
// unresolved department_id aren't attributable to any single department
// row, but are still counted in the Studio-wide/"All departments" totals
// above, same as today.
function buildDepartmentRows(rows: OverviewRow[], departments: Department[]): DepartmentRow[] {
  const rowsByDepartment = new Map<string, OverviewRow[]>();
  for (const row of rows) {
    if (!row.department_id) {
      continue;
    }
    const list = rowsByDepartment.get(row.department_id) ?? [];
    list.push(row);
    rowsByDepartment.set(row.department_id, list);
  }

  return departments
    .map((department) => ({
      department,
      summary: summarize(rowsByDepartment.get(department.id) ?? []),
    }))
    .sort((a, b) => b.summary.totalClasses - a.summary.totalClasses);
}

export default async function DashboardPage() {
  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on class_occurrences/departments are the actual enforcement.
  // No session -> the admin client, same as before.
  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);

  const [rows, departments] = await Promise.all([
    getOverviewRows(supabase),
    getDepartments(supabase),
  ]);

  const orgSummary = summarize(rows);
  const departmentRows = buildDepartmentRows(rows, departments);

  return (
    <DashboardShell
      title="Overview"
      description="Studio health at a glance, based on synced Mindbody class data."
    >
      <section>
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
            Sorted by total classes · this period = all synced history to date
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
                <th className="border-l p-3 text-left text-xs font-semibold text-zinc-400" colSpan={1}>
                  Cost{" "}
                  <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[0.65rem] font-medium normal-case text-zinc-400">
                    Coming soon
                  </span>
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
                <th className="border-l p-3 text-right">Instructor Cost</th>
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
                <MockCells count={1} borderLeft />
              </tr>
              {departmentRows.map(({ department, summary }) => (
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
                  <MockCells count={1} borderLeft />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">
          <span className="font-medium text-zinc-600">This period</span> columns are real, computed
          from synced <code>class_occurrences</code> the same way the Studio-wide cards above are.{" "}
          <span className="font-medium text-zinc-600">Client engagement</span> and{" "}
          <span className="font-medium text-zinc-600">Cost</span> columns are placeholders -- they
          need the client/membership and payroll integrations, neither of which is wired up yet.
        </p>
      </section>
    </DashboardShell>
  );
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
