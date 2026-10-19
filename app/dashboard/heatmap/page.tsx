import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { RoomSelect } from "./room-select";
import { RangeSelect } from "./range-select";
import { WeekNav } from "./week-nav";

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

type OccurrenceIdRow = { id: string; start_datetime: string | null; max_capacity: number | null };

async function getRoomOccurrences(
  supabase: ScopedSupabaseClient,
  roomId: string,
  rangeStart: DateTime,
  rangeEnd: DateTime,
): Promise<OccurrenceRow[]> {
  const { data: occurrences, error } = await supabase
    .from("class_occurrences")
    .select("id, start_datetime, max_capacity")
    .eq("room_id", roomId)
    .not("mindbody_occurrence_id", "is", null)
    // Only occurred classes -- an upcoming class's signed-in count is
    // meaningless, same rule the department heat map already applies.
    .lte("start_datetime", DateTime.now().toUTC().toISO() ?? "")
    .gte("start_datetime", rangeStart.toUTC().toISO() ?? "")
    .lt("start_datetime", rangeEnd.toUTC().toISO() ?? "")
    .returns<OccurrenceIdRow[]>();

  if (error) {
    throw new Error(`Failed to load room occurrences: ${error.message}`);
  }

  const rows = occurrences ?? [];
  if (rows.length === 0) {
    return [];
  }

  // Signed-in count per occurrence comes from class_visits -- the
  // per-attendee check-in rows -- not class_occurrences.total_signed_in.
  // That column is MindBody's /class/classes TotalSignedIn, which lags
  // (studio classes are reconciled days later) and, for a high-frequency
  // room like the pool crowding out the paginated result set, can stop
  // updating for the other rooms entirely -- which is exactly why every
  // non-pool cell here was reading 0%. class_visits is synced per
  // occurrence and stays correct.
  const signedInByOccurrence = new Map<string, number>();
  const occurrenceIds = rows.map((row) => row.id);
  for (let i = 0; i < occurrenceIds.length; i += 500) {
    const { data: visits, error: visitsError } = await supabase
      .from("class_visits")
      .select("occurrence_id")
      .eq("signed_in", true)
      .in("occurrence_id", occurrenceIds.slice(i, i + 500));

    if (visitsError) {
      throw new Error(`Failed to load class visits: ${visitsError.message}`);
    }

    for (const visit of visits ?? []) {
      signedInByOccurrence.set(
        visit.occurrence_id,
        (signedInByOccurrence.get(visit.occurrence_id) ?? 0) + 1,
      );
    }
  }

  return rows.map((row) => ({
    start_datetime: row.start_datetime,
    max_capacity: row.max_capacity,
    total_signed_in: signedInByOccurrence.get(row.id) ?? 0,
  }));
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
    week?: string;
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
        <p className="text-sm text-muted-foreground">
          No rooms synced yet -- nothing to facet a heat map by.
        </p>
      </DashboardShell>
    );
  }

  const selectedRoomId = rooms.some((room) => room.id === params.room) ? (params.room as string) : rooms[0].id;
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)!;

  const now = DateTime.now().setZone(timezone);
  const currentWeekStart = now.minus({ days: now.weekday - 1 }).startOf("day");

  // With no ?week=, show the last FULL week: the current week is mostly
  // not-yet-happened early on, so it opened as a grid of empty cells.
  const defaultWeekStart = currentWeekStart.minus({ days: 7 });

  // Snapped to Monday regardless of what's in the URL, so a hand-edited or
  // stale ?week= value can't land the page on a mid-week boundary.
  let weekStart = defaultWeekStart;
  if (params.week) {
    const parsedWeek = DateTime.fromISO(params.week, { zone: timezone });
    if (parsedWeek.isValid) {
      weekStart = parsedWeek.startOf("day").minus({ days: parsedWeek.weekday - 1 });
    }
  }
  // Future weeks haven't occurred yet -- every fill-rate query below already
  // excludes not-yet-occurred classes, so a week beyond the current one would
  // just render empty. Clamped here rather than relying on WeekNav's
  // disabled "Next week" button alone, since ?week= is directly editable.
  if (weekStart > currentWeekStart) {
    weekStart = currentWeekStart;
  }

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

  const weekEnd = weekStart.plus({ days: 6 });
  const weekLabel =
    weekStart.hasSame(weekEnd, "month") && weekStart.hasSame(weekEnd, "year")
      ? `${weekStart.toFormat("LLL d")}–${weekEnd.toFormat("d, yyyy")}`
      : `${weekStart.toFormat("LLL d")} – ${weekEnd.toFormat("LLL d, yyyy")}`;

  return (
    <DashboardShell
      title="Heat Map"
      description="How full each room is by day and start time, compared with its recent average."
      actions={
        <RangeSelect comparisonWindow={comparisonWindow} comparisonStart={comparisonStart} comparisonEnd={comparisonEnd} />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RoomSelect rooms={rooms} selectedRoomId={selectedRoomId} />
          <WeekNav
            weekStartIso={weekStart.toISODate() ?? ""}
            prevWeekStartIso={weekStart.minus({ days: 7 }).toISODate() ?? ""}
            nextWeekStartIso={weekStart.plus({ days: 7 }).toISODate() ?? ""}
            currentWeekStartIso={currentWeekStart.toISODate() ?? ""}
            defaultWeekStartIso={defaultWeekStart.toISODate() ?? ""}
            weekLabel={weekLabel}
          />
        </div>

        <Card className="gap-4">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{selectedRoom.name}</CardTitle>
              <CardDescription>
                {weekStart.hasSame(currentWeekStart, "day") ? "This week so far" : `Week of ${weekLabel}`}. Small number =
                average over the comparison window.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <LegendSwatch color={TRAFFIC_RED} label="Under 25%" />
              <LegendSwatch color={TRAFFIC_YELLOW} label="25–50%" />
              <LegendSwatch color={TRAFFIC_GREEN} label="50%+" />
              <span className="flex items-center gap-1.5">
                <span className="text-sm leading-none">–</span>
                No class
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {times.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No classes have happened in {selectedRoom.name} in the week of {weekLabel} or the comparison window.
              </p>
            ) : (
              <div className="max-w-full overflow-x-auto">
                <table className="w-full border-separate border-spacing-1 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 w-20 bg-card p-1 text-left text-xs font-medium text-muted-foreground">
                        Time
                      </th>
                      {DAY_LABELS.map((dayLabel) => (
                        <th key={dayLabel} className="min-w-[64px] p-1 text-center text-xs font-medium text-muted-foreground">
                          {dayLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {times.map((time) => (
                      <tr key={time}>
                        <td className="sticky left-0 z-10 bg-card p-1 text-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums">
                          {formatTimeLabel(time)}
                        </td>
                        {DAY_LABELS.map((dayLabel, dayIndex) => {
                          const key = cellKey(dayIndex, time);
                          const thisWeek = thisWeekCells.get(key);
                          const comparison = comparisonCells.get(key);
                          const comparisonAvg = comparison ? comparison.sum / comparison.count : null;

                          if (!thisWeek) {
                            // Nothing here this week. If the slot has history,
                            // say so in the tooltip and show its usual average.
                            return (
                              <td
                                key={dayLabel}
                                className="h-12 rounded-md bg-muted/40 text-center text-xs text-muted-foreground"
                                title={
                                  comparison
                                    ? `${selectedRoom.name} · ${dayLabel} ${formatTimeLabel(time)} · no class this week · usually ${comparisonAvg?.toFixed(0)}% (n=${comparison.count})`
                                    : undefined
                                }
                              >
                                {comparison ? <span className="text-[0.65rem] tabular-nums">–<br />{comparisonAvg?.toFixed(0)}%</span> : "–"}
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
                              key={dayLabel}
                              className="h-12 rounded-md text-center"
                              style={{ backgroundColor: background, color: foreground }}
                              title={`${selectedRoom.name} · ${dayLabel} ${formatTimeLabel(time)} · this week ${thisWeekAvg.toFixed(0)}% (n=${thisWeek.count})${comparisonAvg !== null ? ` · usually ${comparisonAvg.toFixed(0)}% (n=${comparison?.count})` : ""}`}
                            >
                              <span className="block text-xs font-bold tabular-nums">{thisWeekAvg.toFixed(0)}%</span>
                              <span className="flex items-center justify-center gap-0.5 text-[0.65rem] font-medium tabular-nums opacity-90">
                                {arrow ? <span>{arrow}</span> : null}
                                {comparisonAvg !== null ? `${comparisonAvg.toFixed(0)}%` : "new"}
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
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
