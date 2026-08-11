"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type WeekNavProps = {
  weekStartIso: string;
  prevWeekStartIso: string;
  nextWeekStartIso: string;
  currentWeekStartIso: string;
  weekLabel: string;
};

// searchParams-driven, same push-based pattern as RoomSelect/RangeSelect on
// this page. "Next week" is disabled once the selected week is the current
// week -- classes there haven't occurred yet, so every cell would just read
// "No class this week" (this page already excludes not-yet-occurred
// classes from every fill-rate computation).
export function WeekNav({
  weekStartIso,
  prevWeekStartIso,
  nextWeekStartIso,
  currentWeekStartIso,
  weekLabel,
}: WeekNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCurrentWeek = weekStartIso === currentWeekStartIso;

  function goToWeek(nextWeekStart: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextWeekStart === currentWeekStartIso) {
      params.delete("week");
    } else {
      params.set("week", nextWeekStart);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => goToWeek(prevWeekStartIso)}
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 hover:bg-zinc-50"
      >
        ← Previous week
      </button>

      <span className="min-w-[11rem] text-center text-sm font-medium text-zinc-950">{weekLabel}</span>

      <button
        type="button"
        onClick={() => goToWeek(nextWeekStartIso)}
        disabled={isCurrentWeek}
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
      >
        Next week →
      </button>

      {!isCurrentWeek && (
        <button
          type="button"
          onClick={() => goToWeek(currentWeekStartIso)}
          className="text-sm font-medium text-zinc-600 underline hover:text-zinc-950"
        >
          This week
        </button>
      )}
    </div>
  );
}
