import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { RoomSelect } from "./room-select";
import { RangeSelect } from "./range-select";

type Room = { id: string; name: string };

type OccurrenceRow = {
  start_datetime: string | null;
  max_capacity: number | null;
  total_signed_in: number | null;
};

const COMPARISON_PRESET_DAYS: Record<string, number> = { "30": 30, "60": 60, "90": 90 };
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  // Single-org sandbox today (see app/api/sync/classes/route.ts) -- one row,
  // upserted by mindbody_site_id. Same simplification as the Classes page.
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

async function getRooms(supabase: ScopedSupabaseClient): Promise<Room[]> {
  const { data, error } = await supabase.from("rooms").select("id, name").order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load rooms: ${error.message}`);
  }

  return data ?? [];
}

async function getRoomOccurrences(
  supabase: ScopedSupabaseClient,
  roomId: string,
  rangeStart: DateTime,
  rangeEnd: DateTime,
) {
  const { data, error } = await supabase
    .from("class_occurrences")
    .select("start_datetime, max_capacity, total_signed_in")
    .eq("room_id", roomId)
    .not("mindbody_occurrence_id", "is", null)
    // Only occurred classes -- an upcoming class's signed-in count is
    // meaningless, same rule the department heat map already applies.
    .lte("start_datetime", DateTime.now().toUTC().toISO() ?? "")
    .gte("start_datetime", rangeStart.toUTC().toISO() ?? "")
    .lt("start_datetime", rangeEnd.toUTC().toISO() ?? "")
    .returns<OccurrenceRow[]>();

  if (error) {
    throw new Error(`Failed to load room occurrences: ${error.message}`);
  }

  return data ?? [];
}

type Cell = { sum: number; count: number };

function cellKey(dayIndex: number, time: string) {
  return `${dayIndex}|${time}`;
}

// Same per-occurrence-rate averaging the existing department heat map uses
// (sum of each occurrence's own actual fill rate, divided by count) --
// preserved here rather than switched to a sum(signed_in)/sum(capacity)
// aggregate, since that's this page's own established convention already.
function buildCellMap(rows: OccurrenceRow[], timezone: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();

  for (const row of rows) {
    const maxCapacity = row.max_capacity ?? 0;
    if (maxCapacity <= 0 || !row.start_datetime) {
      continue;
    }

    const local = DateTime.fromISO(row.start_datetime, { zone: "utc" }).setZone(timezone);
    const dayIndex = local.weekday - 1;
    const time = local.toFormat("HH:mm");
    const actualFillRate = ((row.total_signed_in ?? 0) / maxCapacity) * 100;

    const key = cellKey(dayIndex, time);
    const cell = cells.get(key) ?? { sum: 0, count: 0 };
    cell.sum += actualFillRate;
    cell.count += 1;
    cells.set(key, cell);
  }

  return cells;
}

function formatTimeLabel(time: string) {
  return DateTime.fromFormat(time, "HH:mm").toFormat("h:mm a");
}

// Colorblind-safe traffic light: orange-tinted red and blue-tinted green
// rather than pure hues, so the red/green pair stays distinguishable for
// deuteranopia/protanopia -- validated with the dataviz skill's
// validate_palette.js (CVD separation ~14.4 dE, well above the >=8 target;
// see conversation history). Thresholds are a first-pass default, not
// derived from this org's actual distribution -- flagged for review since
// this sandbox's real fill rates run 2-8%, which may render almost
// everything red. Never the only signal: the percentage is always rendered
// as visible text on every cell, per the accessibility requirement this
// scale exists to satisfy.
const TRAFFIC_RED = "#D5502A";
const TRAFFIC_YELLOW = "#D9A404";
const TRAFFIC_GREEN = "#0E9488";
const NO_DATA_COLOR = "#e1e0d9";

function trafficLightColor(percent: number) {
  if (percent < 25) return TRAFFIC_RED;
  if (percent < 50) return TRAFFIC_YELLOW;
  return TRAFFIC_GREEN;
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function textColorForBackground(hex: string) {
  return relativeLuminance(hex) > 0.4 ? "#0b0b0b" : "#ffffff";
}

type ResolvedComparisonWindow = {
  comparisonWindow: string;
  comparisonStart: string;
  comparisonEnd: string;
};

function resolveComparisonWindow(
  params: { comparisonWindow?: string; comparisonStart?: string; comparisonEnd?: string },
  weekStart: DateTime,
): ResolvedComparisonWindow {
  if (params.comparisonWindow === "custom" && params.comparisonStart && params.comparisonEnd) {
    return { comparisonWindow: "custom", comparisonStart: params.comparisonStart, comparisonEnd: params.comparisonEnd };
  }

  const comparisonWindow =
    params.comparisonWindow && COMPARISON_PRESET_DAYS[params.comparisonWindow]
      ? params.comparisonWindow
      : "60";

  // Ends at the start of this week, not "now" -- so the comparison baseline
  // never overlaps the days actually being compared against it.
  const start = weekStart.minus({ days: COMPARISON_PRESET_DAYS[comparisonWindow] });

  return {
    comparisonWindow,
    comparisonStart: start.toISODate() ?? "",
    comparisonEnd: weekStart.toISODate() ?? "",
  };
}

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Promise<{
    room?: string;
    comparisonWindow?: string;
    comparisonStart?: string;
    comparisonEnd?: string;
  }>;
}) {
  const params = await searchParams;

  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on class_occurrences/rooms/organizations are the actual
  // enforcement. No session -> the admin client, same as before.
  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);

  const [timezone, rooms] = await Promise.all([getOrgTimezone(supabase), getRooms(supabase)]);

  if (rooms.length === 0) {
    return (
      <DashboardShell
        title="Heat Map"
        description="Actual fill rate by day and start time, per room."
      >
        <p className="text-sm text-zinc-500">
          No rooms synced yet -- nothing to facet a heat map by.
        </p>
      </DashboardShell>
    );
  }

  const selectedRoomId = rooms.some((room) => room.id === params.room) ? (params.room as string) : rooms[0].id;
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)!;

  const now = DateTime.now().setZone(timezone);
  const weekStart = now.minus({ days: now.weekday - 1 }).startOf("day");

  const { comparisonWindow, comparisonStart, comparisonEnd } = resolveComparisonWindow(params, weekStart);
  const comparisonRangeStart = DateTime.fromISO(comparisonStart, { zone: timezone }).startOf("day");
  const comparisonRangeEnd = DateTime.fromISO(comparisonEnd, { zone: timezone }).endOf("day");

  const [thisWeekRows, comparisonRows] = await Promise.all([
    getRoomOccurrences(supabase, selectedRoomId, weekStart, weekStart.plus({ days: 7 })),
    getRoomOccurrences(supabase, selectedRoomId, comparisonRangeStart, comparisonRangeEnd.plus({ millisecond: 1 })),
  ]);

  const thisWeekCells = buildCellMap(thisWeekRows, timezone);
  const comparisonCells = buildCellMap(comparisonRows, timezone);

  const allKeys = new Set<string>([...thisWeekCells.keys(), ...comparisonCells.keys()]);
  const times = Array.from(new Set(Array.from(allKeys).map((key) => key.split("|")[1]))).sort();

  return (
    <DashboardShell
      title="Heat Map"
      description="Actual fill rate (signed-in / capacity) by day and start time, per room. This week vs a comparison window, both from classes that have already occurred."
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <RoomSelect rooms={rooms} selectedRoomId={selectedRoomId} />
        <RangeSelect
          comparisonWindow={comparisonWindow}
          comparisonStart={comparisonStart}
          comparisonEnd={comparisonEnd}
        />
      </div>

      <div className="mb-2 mt-6 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <span>This week&rsquo;s fill rate:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: TRAFFIC_RED }} />
          Under 25%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: TRAFFIC_YELLOW }} />
          25–50%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: TRAFFIC_GREEN }} />
          50%+
        </span>
        <span className="ml-2 flex items-center gap-1 text-xs">
          <span className="inline-block h-3 w-3 rounded border border-zinc-300" style={{ backgroundColor: NO_DATA_COLOR }} />
          No class this week
        </span>
      </div>

      {times.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No classes have occurred in {selectedRoom.name} in this week or the comparison window.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white p-2 text-left text-xs font-medium text-zinc-500">
                  Day
                </th>
                {times.map((time) => (
                  <th key={time} className="p-2 text-center text-xs font-medium text-zinc-500">
                    {formatTimeLabel(time)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((dayLabel, dayIndex) => (
                <tr key={dayLabel}>
                  <td className="sticky left-0 bg-white p-2 text-xs font-medium text-zinc-500">
                    {dayLabel}
                  </td>
                  {times.map((time) => {
                    const key = cellKey(dayIndex, time);
                    const thisWeek = thisWeekCells.get(key);
                    const comparison = comparisonCells.get(key);

                    if (!thisWeek && !comparison) {
                      return (
                        <td key={time} className="p-2 text-center text-xs text-zinc-400" style={{ backgroundColor: NO_DATA_COLOR }}>
                          &ndash;
                        </td>
                      );
                    }

                    const comparisonAvg = comparison ? comparison.sum / comparison.count : null;

                    if (!thisWeek) {
                      // Historical data exists at this slot but nothing has
                      // happened here yet this week -- not colored by the
                      // traffic light, since that's specifically a
                      // this-week status signal with nothing to report yet.
                      return (
                        <td
                          key={time}
                          className="p-2 text-center text-xs text-zinc-400"
                          style={{ backgroundColor: NO_DATA_COLOR }}
                          title={`${selectedRoom.name} · ${dayLabel} ${formatTimeLabel(time)} · no class this week · ${comparisonAvg?.toFixed(0)}% avg over comparison window (n=${comparison?.count})`}
                        >
                          No class
                          <br />
                          this week
                        </td>
                      );
                    }

                    const thisWeekAvg = thisWeek.sum / thisWeek.count;
                    const background = trafficLightColor(thisWeekAvg);
                    const foreground = textColorForBackground(background);
                    const diff = comparisonAvg !== null ? thisWeekAvg - comparisonAvg : null;
                    const arrow = diff !== null && diff >= 4 ? "▲" : diff !== null && diff <= -4 ? "▼" : null;

                    return (
                      <td
                        key={time}
                        className="p-1.5 text-center"
                        style={{ backgroundColor: background, color: foreground }}
                        title={`${selectedRoom.name} · ${dayLabel} ${formatTimeLabel(time)} · this week ${thisWeekAvg.toFixed(0)}% (n=${thisWeek.count})${comparisonAvg !== null ? ` · comparison window avg ${comparisonAvg.toFixed(0)}% (n=${comparison?.count})` : ""}`}
                      >
                        <span className="block text-xs font-bold">{thisWeekAvg.toFixed(0)}%</span>
                        <span className="mt-0.5 flex items-center justify-center gap-0.5 text-[0.65rem] font-medium opacity-90">
                          {arrow ? <span>{arrow}</span> : null}
                          {comparisonAvg !== null ? `${comparisonAvg.toFixed(0)}%` : "N/A"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
