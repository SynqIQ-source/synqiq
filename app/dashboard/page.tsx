import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

type ScopedSupabaseClient = Awaited<ReturnType<typeof getScopedClient>>;

type DateRangeFilter = {
  /** Inclusive lower bound (ISO datetime, UTC) -- omitted means no lower bound. */
  startDate?: string;
  /** Exclusive upper bound (ISO datetime, UTC) -- omitted means no upper bound. */
  endDate?: string;
};

type OverviewRow = {
  id: string;
  max_capacity: number | null;
  fill_rate: number | null;
  attendance_rate: number | null;
  staff: { id: string; display_name: string } | null;
};

async function getOverviewRows(
  supabase: ScopedSupabaseClient,
  range: DateRangeFilter = {},
) {
  let query = supabase
    .from("class_occurrences")
    .select(
      `
      id,
      max_capacity,
      fill_rate,
      attendance_rate,
      staff:staff!class_occurrences_staff_id_fkey ( id, display_name )
      `,
    )
    // The pre-redesign rows never captured an occurrence id -- exclude them
    // rather than let stale/ambiguous data skew the averages.
    .not("mindbody_occurrence_id", "is", null);

  // Structured for a future toggleable date range (e.g. "last 30 days" /
  // "this month") -- today we call this with no range, so both branches are
  // skipped and every synced row is included, since only one day is synced
  // so far.
  if (range.startDate) {
    query = query.gte("start_datetime", range.startDate);
  }
  if (range.endDate) {
    query = query.lt("start_datetime", range.endDate);
  }

  const { data, error } = await query.returns<OverviewRow[]>();

  if (error) {
    throw new Error(`Failed to load overview metrics: ${error.message}`);
  }

  return data ?? [];
}

type InstructorStat = {
  staffId: string;
  displayName: string;
  classCount: number;
  averageFillRate: number;
};

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeInstructorStats(rows: OverviewRow[]): InstructorStat[] {
  const byStaff = new Map<string, { displayName: string; fillRates: number[] }>();

  for (const row of rows) {
    // Only rank instructors resolved to a real staff record from tonight's
    // sync -- rows still relying on the raw instructor_name text fallback
    // aren't attributable to a specific staff member with confidence.
    if (!row.staff) {
      continue;
    }

    const entry = byStaff.get(row.staff.id) ?? {
      displayName: row.staff.display_name,
      fillRates: [] as number[],
    };
    entry.fillRates.push(row.fill_rate ?? 0);
    byStaff.set(row.staff.id, entry);
  }

  return Array.from(byStaff.entries())
    .map(([staffId, { displayName, fillRates }]) => ({
      staffId,
      displayName,
      classCount: fillRates.length,
      averageFillRate: average(fillRates),
    }))
    .sort((a, b) => b.averageFillRate - a.averageFillRate);
}

export default async function DashboardPage() {
  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on class_occurrences/staff are the actual enforcement. No
  // session -> the admin client, same as before.
  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);
  const rows = await getOverviewRows(supabase);

  const totalClasses = rows.length;
  const averageFillRate = average(rows.map((row) => row.fill_rate ?? 0));

  // attendance_rate is now a real stored column, populated by the sync
  // route using the same eligibility rule verified here previously: null
  // for classes nobody booked or that haven't happened yet, so filtering on
  // "not null" is exactly "eligible for the average" -- no ad-hoc
  // recomputation needed on read.
  const rowsEligibleForAttendance = rows.filter(
    (row) => row.attendance_rate !== null,
  );
  const averageAttendanceRate = average(
    rowsEligibleForAttendance.map((row) => row.attendance_rate ?? 0),
  );

  const instructorStats = computeInstructorStats(rows);
  const topInstructors = instructorStats.slice(0, 3);
  const bottomInstructors = instructorStats.slice(-3).reverse();

  return (
    <DashboardShell
      title="Overview"
      description="Studio health at a glance, based on synced Mindbody class data."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Classes Synced" value={totalClasses.toString()} />
        <StatCard label="Avg Fill Rate" value={`${averageFillRate.toFixed(1)}%`} />
        <StatCard
          label="Avg Attendance Rate"
          value={
            rowsEligibleForAttendance.length > 0
              ? `${averageAttendanceRate.toFixed(1)}%`
              : "N/A"
          }
        />
        <StatCard
          label="Instructors Tracked"
          value={instructorStats.length.toString()}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <InstructorTable
          title="Top Instructors (by fill rate)"
          instructors={topInstructors}
        />
        <InstructorTable
          title="Bottom Instructors (by fill rate)"
          instructors={bottomInstructors}
        />
      </div>
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
            <th className="p-3 text-right">Avg Fill Rate</th>
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
                <td className="p-3 text-right">
                  {instructor.averageFillRate.toFixed(1)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
