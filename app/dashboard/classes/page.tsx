import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FillMeter, FillVsUsual } from "@/components/dashboard/fill-meter";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { getExcludedDepartmentIds } from "@/lib/excluded-departments";
import { HistoryWindowSelect } from "./history-window-select";
import { PeriodNav } from "./period-nav";
import { requireModule } from "@/lib/modules";
import { requireAccess } from "@/lib/require-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";

type TableOccurrenceRow = {
  id: string;
  mindbody_occurrence_id: number | null;
  mindbody_class_schedule_id: number | null;
  synqiqOnly?: boolean;
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

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  // Single-org sandbox today (see app/api/sync/classes/route.ts) -- one row,
  // upserted by mindbody_site_id. Same simplification as the rest of the app.
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();

  return data?.timezone ?? "utc";
}

async function getOccurrencesForRange(supabase: ScopedSupabaseClient, rangeStart: DateTime, rangeEnd: DateTime) {
  const { data, error } = await supabase
    .from("class_occurrences")
    .select(
      `
      id,
      mindbody_occurrence_id,
      mindbody_class_schedule_id,
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
    .gte("start_datetime", rangeStart.toUTC().toISO())
    .lt("start_datetime", rangeEnd.toUTC().toISO())
    .order("start_datetime", { ascending: true })
    .returns<TableOccurrenceRow[]>();

  if (error) {
    throw new Error(`Failed to load class occurrences: ${error.message}`);
  }

  return data ?? [];
}

// SynqIQ's calendar for the same range: bookings made in SynqIQ (added to
// Mindbody's counts) and classes that exist only in SynqIQ.
async function getSynqiqForRange(organizationId: string, rangeStart: DateTime, rangeEnd: DateTime) {
  const admin = createSupabaseAdminClient();
  const { data: sessions } = await admin
    .from("class_sessions")
    .select(
      "id, class_name, starts_at, capacity, mindbody_class_schedule_id, removed_from_schedule_at, staff_mindbody_id, mindbody_resource_id, edits",
    )
    .eq("organization_id", organizationId)
    .gte("starts_at", rangeStart.toUTC().toISO()!)
    .lt("starts_at", rangeEnd.toUTC().toISO()!)
    .limit(5000);
  const rows = sessions ?? [];
  const booked = new Map<string, number>();
  const ids = rows.map((row) => row.id as string);
  for (let index = 0; index < ids.length; index += 300) {
    const { data } = await admin
      .from("class_bookings")
      .select("class_session_id")
      .in("class_session_id", ids.slice(index, index + 300))
      .in("status", ["booked", "checked_in"]);
    for (const row of data ?? []) booked.set(row.class_session_id as string, (booked.get(row.class_session_id as string) ?? 0) + 1);
  }
  const bySlot = new Map<string, number>();
  for (const row of rows) {
    if (row.mindbody_class_schedule_id && booked.get(row.id as string)) {
      bySlot.set(`${row.mindbody_class_schedule_id}|${Date.parse(row.starts_at as string)}`, booked.get(row.id as string) ?? 0);
    }
  }

  // SynqIQ-only classes, shaped like Mindbody's rows.
  const only = rows.filter((row) => !row.mindbody_class_schedule_id && !row.removed_from_schedule_at);
  const [{ data: teachers }, { data: rooms }] = only.length
    ? await Promise.all([
        admin
          .from("staff")
          .select("mindbody_staff_id, display_name")
          .eq("organization_id", organizationId)
          .not("mindbody_staff_id", "is", null),
        admin.from("rooms").select("mindbody_resource_id, name").eq("organization_id", organizationId),
      ])
    : [{ data: [] }, { data: [] }];
  const teacherName = new Map((teachers ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));
  const roomName = new Map((rooms ?? []).map((row) => [Number(row.mindbody_resource_id), row.name as string]));
  const synqiqOnly: TableOccurrenceRow[] = only
    .map((row) => {
      const merged = effective("class_session", row as Record<string, unknown> & { edits: Record<string, CatalogValue> | null });
      if (merged.active === false) return null;
      const teacher = merged.staff_mindbody_id ? teacherName.get(Number(merged.staff_mindbody_id)) : undefined;
      const room = merged.mindbody_resource_id ? roomName.get(Number(merged.mindbody_resource_id)) : undefined;
      return {
        id: row.id as string,
        mindbody_occurrence_id: null,
        mindbody_class_schedule_id: null,
        synqiqOnly: true,
        class_name: row.class_name as string,
        instructor_name: null,
        start_datetime: row.starts_at as string,
        max_capacity: (merged.capacity as number | null) ?? null,
        total_booked: booked.get(row.id as string) ?? 0,
        department_id: null,
        staff: teacher ? { display_name: teacher } : null,
        department: { name: "SynqIQ class" },
        room: room ? { name: room } : null,
        organization: null,
      } satisfies TableOccurrenceRow;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  return { bySlot, synqiqOnly };
}

// This project's PostgREST max-rows is 1000 (confirmed empirically) -- a
// plain unbounded .select() silently truncates past that. Only the columns
// buildHistoricalAverageMap actually needs are selected here (no joins),
// since this fetch feeds nothing but the averaging calculation.
async function getHistoricalOccurrences(supabase: ScopedSupabaseClient, windowStart: DateTime, windowEnd: DateTime) {
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
      .order("id") // tie-breaker so pages never overlap or skip rows
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

// The grouping key for "same recurring slot": department + trimmed class
// name + local weekday + local start time. Deliberately not
// mindbody_class_schedule_id or mindbody_occurrence_id -- both are
// per-instance and won't match across different occurrences of the same
// recurring weekly slot (a recreated Mindbody series gets a new schedule_id
// for what a manager would still consider the same slot).
function getSlotKey(row: { department_id: string | null; class_name: string | null; start_datetime: string | null }, timezone: string) {
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

type ViewMode = "day" | "week";

function resolveViewMode(viewModeParam: string | undefined): ViewMode {
  return viewModeParam === "day" ? "day" : "week";
}

function resolveDate(dateParam: string | undefined, viewMode: ViewMode, timezone: string) {
  const parsed = dateParam ? DateTime.fromISO(dateParam, { zone: timezone }) : DateTime.invalid("no date param");
  const base = parsed.isValid ? parsed : DateTime.now().setZone(timezone);

  if (viewMode === "day") {
    return base.startOf("day");
  }

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

  const historyWindow = params.historyWindow && MONTHS_BACK[params.historyWindow] ? params.historyWindow : "3m";

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
    viewMode?: string;
    date?: string;
    historyWindow?: string;
    historyStart?: string;
    historyEnd?: string;
  }>;
}) {
  // Part of the group fitness module: 404 when the studio doesn't have it.
  await requireModule("group_fitness");
  // Every staff member can see the schedule and who is in each class.
  const staff = await requireAccess(() => true);
  const params = await searchParams;

  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on class_occurrences/organizations are the actual enforcement.
  // No session -> the admin client, same as before -- RLS can't authorize a
  // session-less caller, so this preserves current behavior.
  const currentStaff = await getCurrentStaff();
  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  const viewMode = resolveViewMode(params.viewMode);
  const displayStart = resolveDate(params.date, viewMode, timezone);
  const displayStartIso = displayStart.toISODate() ?? "";
  const displayEnd = displayStart.plus(viewMode === "day" ? { days: 1 } : { days: 7 });
  const today = DateTime.now().setZone(timezone).startOf("day").toISODate() ?? "";

  const { historyWindow, historyStart, historyEnd } = resolveHistoryWindow(params, timezone);
  const historyWindowStart = DateTime.fromISO(historyStart, { zone: timezone }).startOf("day");
  const historyWindowEnd = DateTime.fromISO(historyEnd, { zone: timezone }).endOf("day");

  const [rawTableOccurrences, rawHistoricalOccurrences, hiddenDepartmentIds, synqiq] = await Promise.all([
    getOccurrencesForRange(supabase, displayStart, displayEnd),
    getHistoricalOccurrences(supabase, historyWindowStart, historyWindowEnd),
    getExcludedDepartmentIds(supabase),
    getSynqiqForRange(staff.organizationId, displayStart, displayEnd),
  ]);

  // Pool Lanes is excluded from every reporting view except Heat Map -- see
  // lib/excluded-departments.ts. Booked = Mindbody's + SynqIQ's.
  const tableOccurrences = [
    ...rawTableOccurrences
      .filter((occurrence) => !occurrence.department_id || !hiddenDepartmentIds.has(occurrence.department_id))
      .map((occurrence) => {
        const extra =
          occurrence.mindbody_class_schedule_id && occurrence.start_datetime
            ? (synqiq.bySlot.get(`${occurrence.mindbody_class_schedule_id}|${Date.parse(occurrence.start_datetime)}`) ?? 0)
            : 0;
        return extra ? { ...occurrence, total_booked: (occurrence.total_booked ?? 0) + extra } : occurrence;
      }),
    ...synqiq.synqiqOnly.filter((row) => !/pool lane/i.test(row.class_name ?? "")),
  ].sort((a, b) => (a.start_datetime ?? "").localeCompare(b.start_datetime ?? ""));
  const historicalOccurrences = rawHistoricalOccurrences.filter(
    (occurrence) => !occurrence.department_id || !hiddenDepartmentIds.has(occurrence.department_id),
  );

  const historicalAverageMap = buildHistoricalAverageMap(historicalOccurrences, timezone);

  // Week view groups rows under a heading per day, so each row only needs
  // its time -- the old single "Mon, Oct 19 at 6:05 AM CDT" cell wrapped onto
  // three lines in a narrow column.
  const dayGroups = new Map<string, typeof tableOccurrences>();
  for (const occurrence of tableOccurrences) {
    const zone = occurrence.organization?.timezone ?? timezone;
    const dayKey = occurrence.start_datetime
      ? (DateTime.fromISO(occurrence.start_datetime, { zone: "utc" }).setZone(zone).toISODate() ?? "unknown")
      : "unknown";
    const list = dayGroups.get(dayKey) ?? [];
    list.push(occurrence);
    dayGroups.set(dayKey, list);
  }

  return (
    <DashboardShell
      title="Classes"
      description="Every class on the schedule, with how full it is compared with its usual. Open a class to see who is in it and book people in."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodNav viewMode={viewMode} date={displayStartIso} today={today} />
          <HistoryWindowSelect historyWindow={historyWindow} historyStart={historyStart} historyEnd={historyEnd} />
        </div>

        <Card className="py-0">
          {tableOccurrences.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {viewMode === "day" ? "No classes scheduled for this day." : "No classes scheduled for this week."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-[90px] pl-4">Time</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead className="hidden lg:table-cell">Room</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  <TableHead className="pr-4 text-right">Fill vs. usual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...dayGroups.entries()].map(([dayKey, occurrences]) => (
                  <Fragment key={dayKey}>
                    {viewMode === "week" ? (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={6} className="pl-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          {dayKey === "unknown" ? "Unscheduled" : DateTime.fromISO(dayKey).toFormat("cccc, LLL d")}
                          <span className="ml-2 font-normal normal-case">
                            {occurrences.length} class{occurrences.length === 1 ? "" : "es"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {occurrences.map((occurrence) => {
                      const capacity = occurrence.max_capacity ?? 0;
                      const booked = occurrence.total_booked ?? 0;
                      const fillRate = getFillRate(booked, capacity);
                      const instructor = occurrence.staff?.display_name ?? occurrence.instructor_name ?? "Unassigned";
                      const occurrenceTimezone = occurrence.organization?.timezone ?? timezone;
                      const slotKey = getSlotKey(occurrence, occurrenceTimezone);
                      const historical = slotKey ? historicalAverageMap.get(slotKey) : undefined;
                      const usual =
                        historical && historical.capacitySum > 0 ? Math.round((historical.bookedSum / historical.capacitySum) * 100) : null;

                      return (
                        <TableRow key={occurrence.id}>
                          <TableCell className="pl-4 align-top text-sm font-medium tabular-nums">
                            {formatTime(occurrence.start_datetime, occurrenceTimezone)}
                          </TableCell>
                          <TableCell className="align-top">
                            <Link href={`/dashboard/classes/${occurrence.id}`} className="font-medium underline-offset-4 hover:underline">
                              {occurrence.class_name?.trim() ?? "Unknown"}
                            </Link>
                            {occurrence.synqiqOnly ? (
                              <Badge variant="secondary" className="ml-2 align-middle">
                                SynqIQ
                              </Badge>
                            ) : null}
                            <div className="text-xs text-muted-foreground">
                              {occurrence.department?.name ?? "No department"}
                              <span className="lg:hidden"> · {occurrence.room?.name ?? "No room"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            {instructor === "Unassigned" ? (
                              <Badge variant="outline" className="font-normal text-muted-foreground">
                                Unassigned
                              </Badge>
                            ) : (
                              instructor
                            )}
                          </TableCell>
                          <TableCell className="hidden align-top text-muted-foreground lg:table-cell">
                            {occurrence.room?.name ?? "—"}
                          </TableCell>
                          <TableCell className="align-top">
                            <Link
                              href={`/dashboard/classes/${occurrence.id}`}
                              aria-label={`Who's in ${occurrence.class_name?.trim() ?? "this class"}`}
                              className="block rounded-md hover:bg-muted/60"
                            >
                              <FillMeter value={booked} max={capacity} className="ml-auto" />
                            </Link>
                          </TableCell>
                          <TableCell className="pr-4 align-top">
                            <FillVsUsual current={fillRate} usual={usual} comparedCount={historical?.count ?? 0} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}

function formatTime(startDatetime: string | null, timezone: string) {
  if (!startDatetime) {
    return "—";
  }
  return DateTime.fromISO(startDatetime, { zone: "utc" }).setZone(timezone).toFormat("h:mm a");
}
