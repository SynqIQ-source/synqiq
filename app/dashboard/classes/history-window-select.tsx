"use client";

import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";

const PRESETS = [
  { value: "1m", label: "Last 1 month" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "custom", label: "Custom range" },
];

// The window each class's "usual" fill rate is averaged over. Anchored to
// today on the server, never to the browsed week.
export function HistoryWindowSelect({
  historyWindow,
  historyStart,
  historyEnd,
}: {
  historyWindow: string;
  historyStart: string;
  historyEnd: string;
}) {
  return (
    <PresetRangeSelect
      presets={PRESETS}
      paramNames={{ preset: "historyWindow", start: "historyStart", end: "historyEnd" }}
      value={historyWindow}
      start={historyStart}
      end={historyEnd}
      ariaLabel="Compare against"
      prefix="Usual:"
    />
  );
}
