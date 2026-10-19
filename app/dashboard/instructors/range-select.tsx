"use client";

import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";

const PRESETS = [
  { value: "all", label: "All time" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

export function RangeSelect({ range, rangeStart, rangeEnd }: { range: string; rangeStart: string; rangeEnd: string }) {
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
