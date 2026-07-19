import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";

type OverviewRow = {
  id: string;
  department_id: string | null;
  max_capacity: number | null;
  total_signed_in: number | null;
  total_booked: number | null;
  staff: { id: string; display_name: string } | null;
};

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
      .select(
        `
        id,
        department_id,
        max_capacity,
        total_signed_in,
        total_booked,
        staff:staff!class_occurrences_staff_id_fkey ( id, display_name )
        `,
      )
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

async function getDepartmentCategoryMap(supabase: ScopedSupabaseClient) {
  const { data, error } = await supabase
    .from("department_categories")
    .select("department_id, category")
    .returns<{ department_id: string; category: string }[]>();

  if (error) {
    throw new Error(`Failed to load department categories: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.department_id, row.category]));
}

type MetricsSummary = {
  totalClasses: number;
  avgClassSize: number;
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

  for (const row of rows) {
    signedInSum += row.total_signed_in ?? 0;
    capacitySum += row.max_capacity ?? 0;
    bookedSum += row.total_booked ?? 0;
  }

  return {
    totalClasses,
    avgClassSize: totalClasses > 0 ? signedInSum / totalClasses : 0,
    fillRatePct: capacitySum > 0 ? (signedInSum / capacitySum) * 100 : null,
    attendancePct: bookedSum > 0 ? (signedInSum / bookedSum) * 100 : null,
  };
}

type InstructorStat = {
  staffId: string;
  displayName: string;
  classCount: number;
  fillRatePct: number;
};

// Same sum/sum principle as summarize() above, applied per instructor.
function computeInstructorStats(rows: OverviewRow[]): InstructorStat[] {
  const byStaff = new Map<
    string,
    { displayName: string; signedInSum: number; capacitySum: number; classCount: number }
  >();

  for (const row of rows) {
    // Only rank instructors resolved to a real staff record from the sync --
    // rows still relying on the raw instructor_name text fallback aren't
    // attributable to a specific staff member with confidence.
    if (!row.staff) {
      continue;
    }

    const entry = byStaff.get(row.staff.id) ?? {
      displayName: row.staff.display_name,
      signedInSum: 0,
      capacitySum: 0,
      classCount: 0,
    };
    entry.signedInSum += row.total_signed_in ?? 0;
    entry.capacitySum += row.max_capacity ?? 0;
    entry.classCount += 1;
    byStaff.set(row.staff.id, entry);
  }

  return Array.from(byStaff.entries())
    .map(([staffId, { displayName, signedInSum, capacitySum, classCount }]) => ({
      staffId,
      displayName,
      classCount,
      fillRatePct: capacitySum > 0 ? (signedInSum / capacitySum) * 100 : 0,
    }))
    .sort((a, b) => b.fillRatePct - a.fillRatePct);
}

// Fixed display order for the redesign's 5 categories -- not DB-driven,
// since this ordering is a page-level presentation decision, not
// per-org configuration the way the department->category mapping is.
const CATEGORY_SECTIONS: { key: string; label: string }[] = [
  { key: "pilates", label: "Pilates" },
  { key: "group_fitness", label: "Group Fitness" },
  { key: "yoga", label: "Yoga" },
  { key: "cycle", label: "Cycle" },
  { key: "pool_lanes", label: "Pool Lanes" },
];

export default async function DashboardPage() {
  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on class_occurrences/staff/department_categories are the
  // actual enforcement. No session -> the admin client, same as before.
  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);

  const [rows, categoryMap] = await Promise.all([
    getOverviewRows(supabase),
    getDepartmentCategoryMap(supabase),
  ]);

  const orgSummary = summarize(rows);

  const rowsByCategory = new Map<string, OverviewRow[]>();
  for (const row of rows) {
    const category = row.department_id ? categoryMap.get(row.department_id) : undefined;
    if (!category) {
      continue;
    }
    const list = rowsByCategory.get(category) ?? [];
    list.push(row);
    rowsByCategory.set(category, list);
  }

  return (
    <DashboardShell
      title="Overview"
      description="Studio health at a glance, based on synced Mindbody class data."
    >
      <section>
        <h2 className="text-base font-semibold text-zinc-950">Studio-wide</h2>
        <MetricsGrid summary={orgSummary} />
      </section>

      {CATEGORY_SECTIONS.map(({ key, label }) => {
        const categoryRows = rowsByCategory.get(key) ?? [];
        const summary = summarize(categoryRows);
        const instructorStats = computeInstructorStats(categoryRows);
        const topInstructors = instructorStats.slice(0, 3);
        const bottomInstructors = instructorStats.slice(-3).reverse();

        return (
          <section key={key} className="mt-10">
            <h2 className="text-base font-semibold text-zinc-950">{label}</h2>
            <MetricsGrid summary={summary} />

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <InstructorTable
                title={`Top Instructors — ${label}`}
                instructors={topInstructors}
              />
              <InstructorTable
                title={`Bottom Instructors — ${label}`}
                instructors={bottomInstructors}
              />
            </div>
          </section>
        );
      })}
    </DashboardShell>
  );
}

function MetricsGrid({ summary }: { summary: MetricsSummary }) {
  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total Classes" value={summary.totalClasses.toString()} />
      <StatCard
        label="Avg Class Size"
        value={summary.totalClasses > 0 ? summary.avgClassSize.toFixed(1) : "N/A"}
      />
      <StatCard
        label="Fill Rate"
        value={summary.fillRatePct !== null ? `${summary.fillRatePct.toFixed(1)}%` : "N/A"}
      />
      <StatCard
        label="Attendance"
        value={summary.attendancePct !== null ? `${summary.attendancePct.toFixed(1)}%` : "N/A"}
      />
    </div>
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

function InstructorTable({
  title,
  instructors,
}: {
  title: string;
  instructors: InstructorStat[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-3 text-left" colSpan={3}>
              {title}
            </th>
          </tr>
          <tr className="border-b">
            <th className="p-3 text-left">Instructor</th>
            <th className="p-3 text-right">Classes</th>
            <th className="p-3 text-right">Fill Rate</th>
          </tr>
        </thead>
        <tbody>
          {instructors.length === 0 ? (
            <tr>
              <td className="p-3 text-zinc-500" colSpan={3}>
                No data yet.
              </td>
            </tr>
          ) : (
            instructors.map((instructor) => (
              <tr key={instructor.staffId} className="border-b">
                <td className="p-3">{instructor.displayName}</td>
                <td className="p-3 text-right">{instructor.classCount}</td>
                <td className="p-3 text-right">{instructor.fillRatePct.toFixed(1)}%</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
