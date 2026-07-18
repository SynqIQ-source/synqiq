"use client";

import { DateTime } from "luxon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type WeekNavProps = {
  week: string; // ISO date, always a Monday
};

export function WeekNav({ week }: WeekNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(newWeek: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("week", newWeek);
    router.push(`${pathname}?${params.toString()}`);
  }

  function shiftWeek(weeks: number) {
    const next = DateTime.fromISO(week).plus({ weeks }).toISODate();
    if (next) {
      navigate(next);
    }
  }

  function jumpToDate(pickedDate: string) {
    const picked = DateTime.fromISO(pickedDate);
    if (!picked.isValid) {
      return;
    }
    // Snap whatever date was picked to that week's Monday, since `week` is
    // always stored/read as a Monday.
    const monday = picked.minus({ days: picked.weekday - 1 }).toISODate();
    if (monday) {
      navigate(monday);
    }
  }

  const weekStart = DateTime.fromISO(week);
  const weekEnd = weekStart.plus({ days: 6 });
  const label =
    weekStart.month === weekEnd.month
      ? `${weekStart.toFormat("MMM d")} – ${weekEnd.toFormat("d, yyyy")}`
      : `${weekStart.toFormat("MMM d")} – ${weekEnd.toFormat("MMM d, yyyy")}`;

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Week
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label="Previous week"
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          &lsaquo;
        </button>
        <span className="min-w-[11rem] text-center text-sm font-medium text-zinc-950">
          {label}
        </span>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label="Next week"
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          &rsaquo;
        </button>
        <input
          type="date"
          value={week}
          onChange={(event) => {
            if (event.target.value) {
              jumpToDate(event.target.value);
            }
          }}
          aria-label="Jump to week containing date"
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        />
      </div>
    </div>
  );
}
