import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type HeatmapRow = {
  start_datetime: string | null;
  max_capacity: number | null;
  total_signed_in: number | null;
  department: { id: string; name: string } | null;
  organization: { timezone: string | null } | null;
};

async function getHeatmapRows() {
  // Same RLS caveat as the other dashboard pages -- service-role admin
  // client, fine for a single-org sandbox only.
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("class_occurrences")
    .select(
      `
      start_datetime,
      max_capacity,
      total_signed_in,
      department:departments!class_occurrences_department_id_fkey ( id, name ),
      organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      `,
    )
    .not("mindbody_occurrence_id", "is", null)
    // Unlike attendance_rate (which also requires total_booked > 0, since
    // signed_in/booked is undefined at zero bookings), actual_fill_rate
    // divides by max_capacity -- always defined, so a class with 0 bookings
    // still has a valid 0% actual fill rate. Only exclude classes that
    // haven't happened yet, since their signed-in count is meaningless, not
    // because they lack bookings -- a heat map should surface genuinely
    // empty time slots, not hide them as "no data".
    .lte("start_datetime", new Date().toISOString())
    .returns<HeatmapRow[]>();

  if (error) {
    throw new Error(`Failed to load heat map data: ${error.message}`);
  }

  return data ?? [];
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Cell = { sum: number; count: number };

type DepartmentGrid = {
  departmentId: string;
  departmentName: string;
  times: string[]; // "HH:mm", sorted chronologically
  cells: Map<string, Cell>; // key: `${dayIndex}|${time}`
};

function cellKey(dayIndex: number, time: string) {
  return `${dayIndex}|${time}`;
}

function buildDepartmentGrids(rows: HeatmapRow[]): DepartmentGrid[] {
  const grids = new Map<string, DepartmentGrid>();

  for (const row of rows) {
    // Only grid classes resolved to a real department -- nothing to facet
    // an unresolved row by.
    if (!row.department || !row.start_datetime) {
      continue;
    }

    const maxCapacity = row.max_capacity ?? 0;
    if (maxCapacity <= 0) {
      continue;
    }

    const timezone = row.organization?.timezone ?? "utc";
    const local = DateTime.fromISO(row.start_datetime, { zone: "utc" }).setZone(
      timezone,
    );
    const dayIndex = local.weekday - 1; // Luxon: 1=Mon..7=Sun -> 0=Mon..6=Sun
    const time = local.toFormat("HH:mm");
    const actualFillRate = ((row.total_signed_in ?? 0) / maxCapacity) * 100;

    const grid = grids.get(row.department.id) ?? {
      departmentId: row.department.id,
      departmentName: row.department.name,
      times: [],
      cells: new Map<string, Cell>(),
    };

    const key = cellKey(dayIndex, time);
    const cell = grid.cells.get(key) ?? { sum: 0, count: 0 };
    cell.sum += actualFillRate;
    cell.count += 1;
    grid.cells.set(key, cell);

    if (!grid.times.includes(time)) {
      grid.times.push(time);
    }

    grids.set(row.department.id, grid);
  }

  for (const grid of grids.values()) {
    grid.times.sort();
  }

  return Array.from(grids.values()).sort((a, b) =>
    a.departmentName.localeCompare(b.departmentName),
  );
}

function formatTimeLabel(time: string) {
  return DateTime.fromFormat(time, "HH:mm").toFormat("h:mm a");
}

// Sequential single-hue (blue) ramp, light -> dark, from the dataviz skill's
// reference palette. Index 0 = near-zero (recedes toward the surface),
// last index = 100%.
const SEQUENTIAL_BLUE_STEPS = [
  "#cde2fb",
  "#b7d3f6",
  "#9ec5f4",
  "#86b6ef",
  "#6da7ec",
  "#5598e7",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#1c5cab",
  "#184f95",
  "#104281",
  "#0d366b",
];

const NO_DATA_COLOR = "#e1e0d9"; // gridline neutral -- distinct from "true zero"

function colorForValue(percent: number) {
  const clamped = Math.max(0, Math.min(100, percent));
  const index = Math.round((clamped / 100) * (SEQUENTIAL_BLUE_STEPS.length - 1));
  return SEQUENTIAL_BLUE_STEPS[index];
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function textColorForBackground(hex: string) {
  return relativeLuminance(hex) > 0.4 ? "#0b0b0b" : "#ffffff";
}

export default async function HeatmapPage() {
  const rows = await getHeatmapRows();
  const grids = buildDepartmentGrids(rows);

  return (
    <DashboardShell
      title="Attendance Heat Map"
      description="Actual fill rate (signed-in / capacity) by day and start time, one grid per department. Only classes that have already occurred are included."
    >
      <div className="mb-6 flex items-center gap-2 text-sm text-zinc-600">
        <span>Actual fill rate:</span>
        <span className="text-xs">0%</span>
        <div className="flex h-4 w-48 overflow-hidden rounded">
          {SEQUENTIAL_BLUE_STEPS.map((hex) => (
            <div key={hex} style={{ backgroundColor: hex }} className="flex-1" />
          ))}
        </div>
        <span className="text-xs">100%</span>
        <span className="ml-4 flex items-center gap-1 text-xs">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{ backgroundColor: NO_DATA_COLOR }}
          />
          No data
        </span>
      </div>

      {grids.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No eligible classes yet -- nothing has both occurred and been
          resolved to a department.
        </p>
      ) : (
        <div className="space-y-8">
          {grids.map((grid) => (
            <section key={grid.departmentId}>
              <h2 className="mb-2 text-base font-semibold text-zinc-950">
                {grid.departmentName}
              </h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-white p-2 text-left text-xs font-medium text-zinc-500">
                        Day
                      </th>
                      {grid.times.map((time) => (
                        <th
                          key={time}
                          className="p-2 text-center text-xs font-medium text-zinc-500"
                        >
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
                        {grid.times.map((time) => {
                          const cell = grid.cells.get(cellKey(dayIndex, time));

                          if (!cell) {
                            return (
                              <td
                                key={time}
                                className="p-2 text-center text-xs text-zinc-400"
                                style={{ backgroundColor: NO_DATA_COLOR }}
                              >
                                &ndash;
                              </td>
                            );
                          }

                          const average = cell.sum / cell.count;
                          const background = colorForValue(average);
                          const foreground = textColorForBackground(background);

                          return (
                            <td
                              key={time}
                              className="p-2 text-center text-xs font-medium"
                              style={{ backgroundColor: background, color: foreground }}
                              title={`${grid.departmentName} · ${dayLabel} ${formatTimeLabel(time)} · ${average.toFixed(0)}% avg actual fill rate (n=${cell.count})`}
                            >
                              {average.toFixed(0)}%
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
