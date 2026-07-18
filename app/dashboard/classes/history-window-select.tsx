"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { value: "1m", label: "Last 1 month" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "custom", label: "Custom range" },
];

type HistoryWindowSelectProps = {
  historyWindow: string;
  historyStart: string;
  historyEnd: string;
};

export function HistoryWindowSelect({
  historyWindow,
  historyStart,
  historyEnd,
}: HistoryWindowSelectProps) {
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
      updateParams({ historyWindow: "custom", historyStart, historyEnd });
    } else {
      updateParams({
        historyWindow: value,
        historyStart: undefined,
        historyEnd: undefined,
      });
    }
  }

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Compare against
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <select
          value={historyWindow}
          onChange={handleWindowChange}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        >
          {PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>

        {historyWindow === "custom" ? (
          <>
            <input
              type="date"
              value={historyStart}
              onChange={(event) =>
                updateParams({
                  historyWindow: "custom",
                  historyStart: event.target.value,
                  historyEnd,
                })
              }
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
            />
            <span className="text-sm text-zinc-500">to</span>
            <input
              type="date"
              value={historyEnd}
              onChange={(event) =>
                updateParams({
                  historyWindow: "custom",
                  historyStart,
                  historyEnd: event.target.value,
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
