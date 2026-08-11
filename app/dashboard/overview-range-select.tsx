"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { value: "all", label: "All synced history" },
  { value: "ytd", label: "Year to date" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

type OverviewRangeSelectProps = {
  range: string;
  rangeStart: string;
  rangeEnd: string;
};

// Same searchParams-driven preset-or-custom shape as
// app/dashboard/instructors/range-select.tsx and
// app/dashboard/heatmap/range-select.tsx, plus a "ytd" preset (Instructors'
// version has no need for one; Overview's "studio health at a glance" framing
// does).
export function OverviewRangeSelect({ range, rangeStart, rangeEnd }: OverviewRangeSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleRangeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (value === "custom") {
      updateParams({ range: "custom", rangeStart, rangeEnd });
    } else {
      updateParams({ range: value, rangeStart: undefined, rangeEnd: undefined });
    }
  }

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Time frame
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <select
          value={range}
          onChange={handleRangeChange}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        >
          {PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>

        {range === "custom" ? (
          <>
            <input
              type="date"
              value={rangeStart}
              onChange={(event) =>
                updateParams({ range: "custom", rangeStart: event.target.value, rangeEnd })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
            />
            <span className="text-sm text-zinc-500">to</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(event) =>
                updateParams({ range: "custom", rangeStart, rangeEnd: event.target.value })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
