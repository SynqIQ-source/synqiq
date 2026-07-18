"use client";

import { DateTime } from "luxon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ViewMode = "day" | "week";

type PeriodNavProps = {
  viewMode: ViewMode;
  date: string; // ISO date anchor -- Monday in week mode, exact day in day mode
  today: string; // ISO date, "today" in org timezone
};

export function PeriodNav({ viewMode, date, today }: PeriodNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(next: Record<string, string | undefined>) {
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

  function shiftPeriod(amount: number) {
    const next =
      viewMode === "day"
        ? DateTime.fromISO(date).plus({ days: amount }).toISODate()
        : DateTime.fromISO(date).plus({ weeks: amount }).toISODate();
    if (next) {
      navigate({ date: next });
    }
  }

  function jumpToDate(pickedDate: string) {
    const picked = DateTime.fromISO(pickedDate);
    if (!picked.isValid) {
      return;
    }

    if (viewMode === "week") {
      // Snap to that week's Monday, since `date` is always a Monday in week mode.
      const monday = picked.minus({ days: picked.weekday - 1 }).toISODate();
      if (monday) {
        navigate({ date: monday });
      }
    } else {
      const isoDate = picked.toISODate();
      if (isoDate) {
        navigate({ date: isoDate });
      }
    }
  }

  function switchToDay() {
    // Always resets to today, regardless of whatever day/week was showing --
    // Day mode is for "look at today (or a specific day) in isolation."
    navigate({ viewMode: "day", date: today });
  }

  function switchToWeek() {
    // Preserves continuity: shows the week containing whatever day was selected.
    const current = DateTime.fromISO(date);
    const monday = current.minus({ days: current.weekday - 1 }).toISODate();
    navigate({ viewMode: "week", date: monday ?? date });
  }

  const anchor = DateTime.fromISO(date);
  const label =
    viewMode === "day"
      ? anchor.toFormat("EEE, MMM d, yyyy")
      : (() => {
          const weekEnd = anchor.plus({ days: 6 });
          return anchor.month === weekEnd.month
            ? `${anchor.toFormat("MMM d")} – ${weekEnd.toFormat("d, yyyy")}`
            : `${anchor.toFormat("MMM d")} – ${weekEnd.toFormat("MMM d, yyyy")}`;
        })();

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {viewMode === "day" ? "Day" : "Week"}
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => shiftPeriod(-1)}
          aria-label={viewMode === "day" ? "Previous day" : "Previous week"}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          &lsaquo;
        </button>
        <span className="min-w-[11rem] text-center text-sm font-medium text-zinc-950">
          {label}
        </span>
        <div className="flex rounded-md border border-zinc-200 bg-white p-0.5">
          <button
            type="button"
            onClick={switchToDay}
            aria-pressed={viewMode === "day"}
            className={`rounded px-2 py-1 text-sm font-medium ${
              viewMode === "day" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            Day
          </button>
          <button
            type="button"
            onClick={switchToWeek}
            aria-pressed={viewMode === "week"}
            className={`rounded px-2 py-1 text-sm font-medium ${
              viewMode === "week" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            Week
          </button>
        </div>
        <button
          type="button"
          onClick={() => shiftPeriod(1)}
          aria-label={viewMode === "day" ? "Next day" : "Next week"}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          &rsaquo;
        </button>
        <input
          type="date"
          value={date}
          onChange={(event) => {
            if (event.target.value) {
              jumpToDate(event.target.value);
            }
          }}
          aria-label={viewMode === "day" ? "Jump to date" : "Jump to week containing date"}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        />
      </div>
    </div>
  );
}
