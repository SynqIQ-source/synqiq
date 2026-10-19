"use client";

import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";

const PRESETS = [
  { value: "30", label: "Trailing 30 days" },
  { value: "60", label: "Trailing 60 days" },
  { value: "90", label: "Trailing 90 days" },
  { value: "custom", label: "Custom range" },
];

// The window the selected week is compared against. Day-based presets,
// since a heat map's comparison window is naturally shorter than Classes'.
export function RangeSelect({
  comparisonWindow,
  comparisonStart,
  comparisonEnd,
}: {
  comparisonWindow: string;
  comparisonStart: string;
  comparisonEnd: string;
}) {
  return (
    <PresetRangeSelect
      presets={PRESETS}
      paramNames={{ preset: "comparisonWindow", start: "comparisonStart", end: "comparisonEnd" }}
      value={comparisonWindow}
      start={comparisonStart}
      end={comparisonEnd}
      ariaLabel="Compare against"
      prefix="vs."
    />
  );
}
