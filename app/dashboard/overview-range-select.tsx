"use client";

import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "wtd", label: "Week to date" },
  { value: "mtd", label: "Month to date" },
  { value: "custom", label: "Custom range" },
];

// Same preset-or-custom shape as Instructors/Heat Map, with to-date presets
// (weeks start Monday). Month to date is the default.
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
