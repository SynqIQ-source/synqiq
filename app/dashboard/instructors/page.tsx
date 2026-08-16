import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { getExcludedDepartmentIds } from "@/lib/excluded-departments";
import { RangeSelect } from "./range-select";
import { InstructorTable } from "./instructor-table";

type StaffRow = { id: string; display_name: string };
type SubstitutionRequestRow = {
  requested_by: string;
  status: string;
  occurrence_id: string;
  created_at: string;
  resolved_at: string | null;
  department_id: string | null;
};
type OccurrenceRow = {
  id: string;
  staff_id: string | null;
  substitute_staff_id: string | null;
  max_capacity: number | null;
  total_signed_in: number | null;
  department_id: string | null;
};

const PAGE_SIZE = 1000;
const RANGE_PRESET_DAYS: Record<string, number> = { "30": 30, "60": 60, "90": 90 };

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

async function getInstructors(supabase: ScopedSupabaseClient): Promise<StaffRow[]> {
  const { data, error } = await supabase.from("staff").select("id, display_name").eq("role", "instructor");

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return data ?? [];
}

async function getSubstitutionRequests(supabase: ScopedSupabaseClient): Promise<SubstitutionRequestRow[]> {
  // Embeds the occurrence's department_id (not otherwise on
  // substitution_requests itself) so Pool Lanes requests can be excluded
  // below -- substitution_requests isn't date-range-scoped like occurrences
  // is, so there's no other row here to join against for that.
  const { data, error } = await supabase
    .from("substitution_requests")
    .select("requested_by, status, occurrence_id, created_at, resolved_at, occurrence:class_occurrences!inner ( department_id )")
    .returns<Array<Omit<SubstitutionRequestRow, "department_id"> & { occurrence: { department_id: string | null } | null }>>();

  if (error) {
    throw new Error(`Failed to load substitution requests: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    requested_by: row.requested_by,
    status: row.status,
    occurrence_id: row.occurrence_id,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    department_id: row.occurrence?.department_id ?? null,
  }));
}

// Same pagination caveat as the Overview/Classes pages -- PostgREST's
// 1000-row max means an unbounded select silently truncates. Restricted to
// already-occurred classes (like Overview/Heat Map) since fill rate is
// meaningless for a class that hasn't happened yet -- this page is a
// performance benchmark now, not a forward-looking roster, so "Classes
// Scheduled" shares that same occurred-only scope for consistency.
async function getOccurrences(
  supabase: ScopedSupabaseClient,
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null,
): Promise<OccurrenceRow[]> {
  const allRows: OccurrenceRow[] = [];
  let offset = 0;
  const nowIso = DateTime.now().toUTC().toISO() ?? "";

  for (;;) {
    let query = supabase
      .from("class_occurrences")
      .select("id, staff_id, substitute_staff_id, max_capacity, total_signed_in, department_id")
      .not("mindbody_occurrence_id", "is", null)
      .lte("start_datetime", nowIso);

    if (rangeStart) {
      query = query.gte("start_datetime", rangeStart.toUTC().toISO() ?? "");
    }
    if (rangeEnd) {
      query = query.lte("start_datetime", rangeEnd.toUTC().toISO() ?? "");
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1).returns<OccurrenceRow[]>();

    if (error) {
      throw new Error(`Failed to load class occurrences: ${error.message}`);
    }

    allRows.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return allRows;
}

// "All time" (rangeStart/rangeEnd both null) always matches. Otherwise
// applied per-column, not at the query level -- substitution_requests is
// small enough to fetch whole, and "released" and "picked up" filter on two
// different timestamp columns (created_at vs resolved_at), so one query
// with one date filter can't serve both anyway.
function isWithinRange(isoDate: string | null, rangeStart: DateTime | null, rangeEnd: DateTime | null) {
  if (!rangeStart || !rangeEnd) {
    return true;
  }
  if (!isoDate) {
    return false;
  }
  const dt = DateTime.fromISO(isoDate);
  return dt >= rangeStart && dt <= rangeEnd;
}

type MetricsSummary = {
  scheduled: number;
  released: number;
  pickedUp: number;
  fillRatePct: number | null;
};

export type InstructorStat = { staffId: string; displayName: string } & MetricsSummary;

function buildInstructorStats(
  staff: StaffRow[],
  subRequests: SubstitutionRequestRow[],
  occurrences: OccurrenceRow[],
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null,
): InstructorStat[] {
  const scheduledByStaff = new Map<string, { count: number; signedInSum: number; capacitySum: number }>();
  // Only class_occurrences (not substitution_requests) actually records who
  // ended up covering a class -- substitution_requests has no
  // selected-staff column of its own, so resolving "picked up as sub" means
  // joining an approved request back to its occurrence's substitute_staff_id.
  const substituteByOccurrence = new Map<string, string | null>();

  for (const occurrence of occurrences) {
    substituteByOccurrence.set(occurrence.id, occurrence.substitute_staff_id);

    if (!occurrence.staff_id) {
      continue;
    }
    const entry = scheduledByStaff.get(occurrence.staff_id) ?? { count: 0, signedInSum: 0, capacitySum: 0 };
    entry.count += 1;
    entry.signedInSum += occurrence.total_signed_in ?? 0;
    entry.capacitySum += occurrence.max_capacity ?? 0;
    scheduledByStaff.set(occurrence.staff_id, entry);
  }

  const releasedByStaff = new Map<string, number>();
  const pickedUpByStaff = new Map<string, number>();

  for (const request of subRequests) {
    if (isWithinRange(request.created_at, rangeStart, rangeEnd)) {
      releasedByStaff.set(request.requested_by, (releasedByStaff.get(request.requested_by) ?? 0) + 1);
    }

    if (request.status === "approved" && isWithinRange(request.resolved_at, rangeStart, rangeEnd)) {
      const substituteStaffId = substituteByOccurrence.get(request.occurrence_id);
      if (substituteStaffId) {
        pickedUpByStaff.set(substituteStaffId, (pickedUpByStaff.get(substituteStaffId) ?? 0) + 1);
      }
    }
  }

  return staff
    .map((member) => {
      const scheduledEntry = scheduledByStaff.get(member.id);
      return {
        staffId: member.id,
        displayName: member.display_name,
        scheduled: scheduledEntry?.count ?? 0,
        // True aggregate (sum signed-in / sum capacity), not a mean of each
        // class's own fill rate -- same reasoning as every other fill-rate
        // computation in this app. Spans every class this instructor
        // taught in the window regardless of department/class_name, which
        // is the actual point: one blended number to benchmark instructors
        // against each other, not a rate that varies by class style.
        fillRatePct:
          scheduledEntry && scheduledEntry.capacitySum > 0
            ? (scheduledEntry.signedInSum / scheduledEntry.capacitySum) * 100
            : null,
        released: releasedByStaff.get(member.id) ?? 0,
        pickedUp: pickedUpByStaff.get(member.id) ?? 0,
      };
    })
    // Staff with no activity at all in the selected window add nothing to
    // scan past -- same reasoning as Overview showing every department but
    // this table not showing every one of ~137 staff.
    .filter((row) => row.scheduled > 0 || row.released > 0 || row.pickedUp > 0)
    .sort((a, b) => b.scheduled - a.scheduled);
}

// Org-wide totals, computed directly from the raw rows rather than by
// summing the (instructor-role-only) table above -- a request released by
// an admin (confirmed: one of this org's 3 real rows is exactly this,
// requested_by an admin, not an instructor) would otherwise silently drop
// out of the Studio-wide count just because it's excluded from the
// per-instructor breakdown. Same "Studio-wide = everything, per-row =
// filtered" split the Overview page already uses.
function summarizeSubstitutionActivity(
  subRequests: SubstitutionRequestRow[],
  occurrences: OccurrenceRow[],
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null,
) {
  const substituteByOccurrence = new Map<string, string | null>();
  for (const occurrence of occurrences) {
    substituteByOccurrence.set(occurrence.id, occurrence.substitute_staff_id);
  }

  const totalReleased = subRequests.filter((request) =>
    isWithinRange(request.created_at, rangeStart, rangeEnd),
  ).length;

  const totalPickedUp = subRequests.filter(
    (request) =>
      request.status === "approved" &&
      isWithinRange(request.resolved_at, rangeStart, rangeEnd) &&
      substituteByOccurrence.get(request.occurrence_id),
  ).length;

  return { totalReleased, totalPickedUp };
}

type ResolvedRange = { range: string; rangeStart: string; rangeEnd: string };

function resolveRange(
  params: { range?: string; rangeStart?: string; rangeEnd?: string },
  timezone: string,
): ResolvedRange {
  if (params.range === "custom" && params.rangeStart && params.rangeEnd) {
    return { range: "custom", rangeStart: params.rangeStart, rangeEnd: params.rangeEnd };
  }

  if (params.range && RANGE_PRESET_DAYS[params.range]) {
    const now = DateTime.now().setZone(timezone);
    const start = now.minus({ days: RANGE_PRESET_DAYS[params.range] });
    return { range: params.range, rangeStart: start.toISODate() ?? "", rangeEnd: now.toISODate() ?? "" };
  }

  return { range: "all", rangeStart: "", rangeEnd: "" };
}

export default async function InstructorsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; rangeStart?: string; rangeEnd?: string }>;
}) {
  const params = await searchParams;

  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  const { range, rangeStart, rangeEnd } = resolveRange(params, timezone);
  const rangeStartDT = range === "all" ? null : DateTime.fromISO(rangeStart, { zone: timezone }).startOf("day");
  const rangeEndDT = range === "all" ? null : DateTime.fromISO(rangeEnd, { zone: timezone }).endOf("day");

  const [staff, rawSubRequests, rawOccurrences, hiddenDepartmentIds] = await Promise.all([
    getInstructors(supabase),
    getSubstitutionRequests(supabase),
    getOccurrences(supabase, rangeStartDT, rangeEndDT),
    getExcludedDepartmentIds(supabase),
  ]);

  // Pool Lanes is excluded from every reporting view except Heat Map -- see
  // lib/excluded-departments.ts.
  const subRequests = rawSubRequests.filter(
    (request) => !request.department_id || !hiddenDepartmentIds.has(request.department_id),
  );
  const occurrences = rawOccurrences.filter(
    (occurrence) => !occurrence.department_id || !hiddenDepartmentIds.has(occurrence.department_id),
  );

  const instructorStats = buildInstructorStats(staff, subRequests, occurrences, rangeStartDT, rangeEndDT);
  const { totalReleased, totalPickedUp } = summarizeSubstitutionActivity(
    subRequests,
    occurrences,
    rangeStartDT,
    rangeEndDT,
  );

  return (
    <DashboardShell
      title="Instructors"
      description="Coverage activity per instructor: what they release, what they teach, and what they pick up for others."
    >
      <RangeSelect range={range} rangeStart={rangeStart} rangeEnd={rangeEnd} />

      <section className="mt-6">
        <h2 className="text-base font-semibold text-zinc-950">Studio-wide</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Classes Released for Coverage" value={totalReleased.toString()} />
          <StatCard label="Picked Up as a Sub" value={totalPickedUp.toString()} />
          <StatCard
            label="Org-wide Pickup Rate"
            value={totalReleased > 0 ? `${((totalPickedUp / totalReleased) * 100).toFixed(0)}%` : "N/A"}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-zinc-950">By Instructor</h2>

        <InstructorTable rows={instructorStats} />

        <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">
          <span className="font-medium text-zinc-600">Classes Scheduled</span> and{" "}
          <span className="font-medium text-zinc-600">Avg Fill Rate</span> are scoped to the time
          frame above and only count classes that have already occurred.{" "}
          <span className="font-medium text-zinc-600">Avg Fill Rate</span> is a true aggregate
          (total signed-in ÷ total capacity across every class they taught, any department or class
          name) so it benchmarks instructors on one blended number, not one that shifts by class
          style. <span className="font-medium text-zinc-600">Released for Coverage</span> counts
          requests created in the window; <span className="font-medium text-zinc-600">
            Picked Up as Sub
          </span>{" "}
          counts approved requests resolved in the window.
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
