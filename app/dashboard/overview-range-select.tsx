"use client";

import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";

const PRESETS = [
  { value: "all", label: "All synced history" },
  { value: "ytd", label: "Year to date" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

// Same preset-or-custom shape as Instructors/Heat Map, plus a "ytd" preset
// that Overview's "studio health at a glance" framing calls for.
export function OverviewRangeSelect({
  range,
  rangeStart,
  rangeEnd,
}: {
  range: string;
  rangeStart: string;
  rangeEnd: string;
}) {
  return (
    <PresetRangeSelect
      presets={PRESETS}
      paramNames={{ preset: "range", start: "rangeStart", end: "rangeEnd" }}
      value={range}
      start={rangeStart}
      end={rangeEnd}
      ariaLabel="Time frame"
    />
  );
}
