"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { value: "30", label: "Trailing 30 days" },
  { value: "60", label: "Trailing 60 days" },
  { value: "90", label: "Trailing 90 days" },
  { value: "custom", label: "Custom range" },
];

type RangeSelectProps = {
  comparisonWindow: string;
  comparisonStart: string;
  comparisonEnd: string;
};

// Mirrors app/dashboard/classes/history-window-select.tsx's shape -- same
// searchParams-driven preset-or-custom pattern, day-based presets instead
// of month-based since a heat map's comparison window is naturally shorter.
export function RangeSelect({ comparisonWindow, comparisonStart, comparisonEnd }: RangeSelectProps) {
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

  function handleWindowChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (value === "custom") {
      updateParams({ comparisonWindow: "custom", comparisonStart, comparisonEnd });
    } else {
      updateParams({
        comparisonWindow: value,
        comparisonStart: undefined,
        comparisonEnd: undefined,
      });
    }
  }

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Compare this week against
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <select
          value={comparisonWindow}
          onChange={handleWindowChange}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        >
          {PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>

        {comparisonWindow === "custom" ? (
          <>
            <input
              type="date"
              value={comparisonStart}
              onChange={(event) =>
                updateParams({
                  comparisonWindow: "custom",
                  comparisonStart: event.target.value,
                  comparisonEnd,
                })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
            />
            <span className="text-sm text-zinc-500">to</span>
            <input
              type="date"
              value={comparisonEnd}
              onChange={(event) =>
                updateParams({
                  comparisonWindow: "custom",
                  comparisonStart,
                  comparisonEnd: event.target.value,
                })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
