import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { HistoryWindowSelect } from "./history-window-select";
import { WeekNav } from "./week-nav";

type WeekOccurrenceRow = {
  id: string;
  mindbody_occurrence_id: number | null;
  class_name: string | null;
  instructor_name: string | null;
  start_datetime: string | null;
  max_capacity: number | null;
  total_booked: number | null;
  department_id: string | null;
  staff: { display_name: string } | null;
  department: { name: string | null } | null;
  room: { name: string | null } | null;
  organization: { timezone: string | null } | null;
};

type HistoricalOccurrenceRow = {
  department_id: string | null;
  class_name: string | null;
  start_datetime: string | null;
  total_booked: number | null;
  max_capacity: number | null;
};

const MONTHS_BACK: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };
const HISTORY_PAGE_SIZE = 1000;

async function getOrgTimezone() {
  // Single-org sandbox today (see app/api/sync/classes/route.ts) -- one row,
  // upserted by mindbody_site_id. Same simplification as the rest of the app.
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("timezone")
    .limit(1)
    .maybeSingle();

  return data?.timezone ?? "utc";
}

// TODO(blocker before Sprint 3 / multi-tenant dashboard work): both queries
// below use the service-role admin client, which bypasses Row Level
// Security entirely. There are currently no RLS policies on
// class_occurrences (or its joined tables), and the anon-key server client
// (lib/supabase/server.ts) returns zero rows for everything -- confirmed
// empirically. Fine for a single-org sandbox, but unsafe the moment a
// second organization exists: nothing stops these queries from returning
// every org's data. Needs either RLS policies scoped by organization_id + a
// real authenticated (non-admin) client, or equivalent app-level tenant
// scoping, before this goes near a shared alpha.
async function getWeekOccurrences(weekStart: DateTime) {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("class_occurrences")
    .select(
      `
      id,
      mindbody_occurrence_id,
      class_name,
      instructor_name,
      start_datetime,
      max_capacity,
      total_booked,
      department_id,
      staff:staff!class_occurrences_staff_id_fkey ( display_name ),
      department:departments!class_occurrences_department_id_fkey ( name ),
      room:rooms!class_occurrences_room_id_fkey ( name ),
      organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      `,
    )
    .not("mindbody_occurrence_id", "is", null)
    .gte("start_datetime", weekStart.toUTC().toISO())
    .lt("start_datetime", weekStart.plus({ days: 7 }).toUTC().toISO())
    .order("start_datetime", { ascending: true })
    .returns<WeekOccurrenceRow[]>();

  if (error) {
    throw new Error(`Failed to load week's class occurrences: ${error.message}`);
  }

  return data ?? [];
}

// This project's PostgREST max-rows is 1000 (confirmed empirically) -- a
// plain unbounded .select() silently truncates past that. Only the columns
// buildHistoricalAverageMap actually needs are selected here (no joins),
// since this fetch feeds nothing but the averaging calculation.
async function getHistoricalOccurrences(windowStart: DateTime, windowEnd: DateTime) {
  const supabase = createSupabaseAdminClient();
  const allRows: HistoricalOccurrenceRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("class_occurrences")
      .select("department_id, class_name, start_datetime, total_booked, max_capacity")
      .not("mindbody_occurrence_id", "is", null)
      .gte("start_datetime", windowStart.toUTC().toISO())
      .lte("start_datetime", windowEnd.toUTC().toISO())
      .order("start_datetime", { ascending: true })
      .range(offset, offset + HISTORY_PAGE_SIZE - 1)
      .returns<HistoricalOccurrenceRow[]>();

    if (error) {
      throw new Error(`Failed to load historical class occurrences: ${error.message}`);
    }

    allRows.push(...(data ?? []));

    if (!data || data.length < HISTORY_PAGE_SIZE) {
      break;
    }

    offset += HISTORY_PAGE_SIZE;
  }

  return allRows;
}

function getFillRate(totalBooked = 0, maxCapacity = 0) {
  if (maxCapacity <= 0) {
    return 0;
  }

  return Math.round((totalBooked / maxCapacity) * 100);
}

function formatStartTime(startDatetime: string | null, timezone: string | null) {
  if (!startDatetime) {
    return "N/A";
  }

  return DateTime.fromISO(startDatetime, { zone: "utc" })
    .setZone(timezone ?? "utc")
    .toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
}

// The grouping key for "same recurring slot": department + trimmed class
// name + local weekday + local start time. Deliberately not
// mindbody_class_schedule_id or mindbody_occurrence_id -- both are
// per-instance and won't match across different occurrences of the same
// recurring weekly slot (a recreated Mindbody series gets a new schedule_id
// for what a manager would still consider the same slot).
function getSlotKey(
  row: { department_id: string | null; class_name: string | null; start_datetime: string | null },
  timezone: string,
) {
  if (!row.department_id || !row.class_name || !row.start_datetime) {
    return null;
  }

  const zoned = DateTime.fromISO(row.start_datetime, { zone: "utc" }).setZone(timezone);

  return `${row.department_id}::${row.class_name.trim()}::${zoned.weekday}::${zoned.toFormat("HH:mm")}`;
}

// A true aggregate (sum booked / sum capacity), not a mean of each
// occurrence's individual fill_rate percentage -- averaging percentages
// directly lets tiny-capacity outliers dominate (e.g. a capacity-1 class
// that gets overbooked to 2-3 shows a 200-300% single-occurrence "fill
// rate", which would skew a plain average far more than its actual
// attendance volume warrants). Summing raw booked/capacity first weights
// every occurrence by its real size before dividing.
function buildHistoricalAverageMap(rows: HistoricalOccurrenceRow[], timezone: string) {
  const map = new Map<string, { bookedSum: number; capacitySum: number; count: number }>();

  for (const row of rows) {
    const key = getSlotKey(row, timezone);
    if (!key) {
      continue;
    }

    const entry = map.get(key) ?? { bookedSum: 0, capacitySum: 0, count: 0 };
    entry.bookedSum += row.total_booked ?? 0;
    entry.capacitySum += row.max_capacity ?? 0;
    entry.count += 1;
    map.set(key, entry);
  }

  return map;
}

function resolveWeekStart(weekParam: string | undefined, timezone: string) {
  const parsed = weekParam
    ? DateTime.fromISO(weekParam, { zone: timezone })
    : DateTime.invalid("no week param");
  const base = parsed.isValid ? parsed : DateTime.now().setZone(timezone);

  // Normalize to Monday regardless of what was passed in -- `weekday` is
  // ISO (Monday=1..Sunday=7), so this is locale-independent.
  return base.minus({ days: base.weekday - 1 }).startOf("day");
}

type ResolvedHistoryWindow = {
  historyWindow: string;
  historyStart: string;
  historyEnd: string;
};

function resolveHistoryWindow(
  params: { historyWindow?: string; historyStart?: string; historyEnd?: string },
  timezone: string,
): ResolvedHistoryWindow {
  // Anchored to "now", never to the browsed week -- paging to a past week
  // must not shift the comparison baseline out from under it.
  const now = DateTime.now().setZone(timezone);

  if (params.historyWindow === "custom" && params.historyStart && params.historyEnd) {
    return { historyWindow: "custom", historyStart: params.historyStart, historyEnd: params.historyEnd };
  }

  const historyWindow =
    params.historyWindow && MONTHS_BACK[params.historyWindow] ? params.historyWindow : "3m";

  return {
    historyWindow,
    historyStart: now.minus({ months: MONTHS_BACK[historyWindow] }).toISODate() ?? "",
    historyEnd: now.toISODate() ?? "",
  };
}

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    historyWindow?: string;
    historyStart?: string;
    historyEnd?: string;
  }>;
}) {
  const params = await searchParams;
  const timezone = await getOrgTimezone();

  const weekStart = resolveWeekStart(params.week, timezone);
  const weekStartIso = weekStart.toISODate() ?? "";

  const { historyWindow, historyStart, historyEnd } = resolveHistoryWindow(params, timezone);
  const historyWindowStart = DateTime.fromISO(historyStart, { zone: timezone }).startOf("day");
  const historyWindowEnd = DateTime.fromISO(historyEnd, { zone: timezone }).endOf("day");

  const [weekOccurrences, historicalOccurrences] = await Promise.all([
    getWeekOccurrences(weekStart),
    getHistoricalOccurrences(historyWindowStart, historyWindowEnd),
  ]);

  const historicalAverageMap = buildHistoricalAverageMap(historicalOccurrences, timezone);

  return (
    <DashboardShell
      title="Classes"
      description="Live Mindbody class schedule data."
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <WeekNav week={weekStartIso} />
        <HistoryWindowSelect
          historyWindow={historyWindow}
          historyStart={historyStart}
          historyEnd={historyEnd}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left">Occurrence ID</th>
              <th className="p-3 text-left">Class</th>
              <th className="p-3 text-left">Start Time</th>
              <th className="p-3 text-left">Instructor</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Room</th>
              <th className="p-3 text-right">Capacity</th>
              <th className="p-3 text-right">Booked</th>
              <th className="p-3 text-right">Fill Rate</th>
              <th className="p-3 text-right">Historical Avg Fill Rate</th>
              <th className="p-3 text-right">Classes Compared</th>
            </tr>
          </thead>
          <tbody>
            {weekOccurrences.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-6 text-center text-zinc-500">
                  No classes scheduled for this week.
                </td>
              </tr>
            ) : (
              weekOccurrences.map((occurrence) => {
                const capacity = occurrence.max_capacity ?? 0;
                const booked = occurrence.total_booked ?? 0;
                const fillRate = getFillRate(booked, capacity);
                const instructor =
                  occurrence.staff?.display_name ?? occurrence.instructor_name ?? "Unassigned";
                const department = occurrence.department?.name ?? "Not assigned";
                const room = occurrence.room?.name ?? "Not assigned";
                const occurrenceTimezone = occurrence.organization?.timezone ?? timezone;

                const slotKey = getSlotKey(occurrence, occurrenceTimezone);
                const historical = slotKey ? historicalAverageMap.get(slotKey) : undefined;
                const historicalAvgLabel =
                  historical && historical.capacitySum > 0
                    ? `${Math.round((historical.bookedSum / historical.capacitySum) * 100)}%`
                    : "N/A";
                const classesComparedLabel = historical
                  ? `${historical.count} class${historical.count === 1 ? "" : "es"}`
                  : "—";

                return (
                  <tr key={occurrence.id} className="border-b">
                    <td className="p-3 font-mono text-xs text-zinc-500">
                      {occurrence.mindbody_occurrence_id}
                    </td>
                    <td className="p-3">{occurrence.class_name ?? "Unknown"}</td>
                    <td className="p-3">
                      {formatStartTime(occurrence.start_datetime, occurrenceTimezone)}
                    </td>
                    <td className="p-3">{instructor}</td>
                    <td className="p-3">{department}</td>
                    <td className="p-3">{room}</td>
                    <td className="p-3 text-right">{capacity}</td>
                    <td className="p-3 text-right">{booked}</td>
                    <td className="p-3 text-right">{fillRate}%</td>
                    <td className="p-3 text-right">{historicalAvgLabel}</td>
                    <td className="p-3 text-right">{classesComparedLabel}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
