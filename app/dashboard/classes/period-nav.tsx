"use client";

import { DateTime } from "luxon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DATE_INPUT_CLASS } from "@/components/dashboard/preset-range-select";
import { cn } from "@/lib/utils";

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

  const toggleClass = (active: boolean) =>
    cn(
      "rounded-[5px] px-2.5 py-1 text-sm font-medium transition-colors",
      active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => shiftPeriod(-1)}
          aria-label={viewMode === "day" ? "Previous day" : "Previous week"}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-[10.5rem] text-center text-sm font-semibold text-foreground">{label}</span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => shiftPeriod(1)}
          aria-label={viewMode === "day" ? "Next day" : "Next week"}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="flex rounded-md bg-muted p-0.5">
        <button type="button" onClick={switchToDay} aria-pressed={viewMode === "day"} className={toggleClass(viewMode === "day")}>
          Day
        </button>
        <button type="button" onClick={switchToWeek} aria-pressed={viewMode === "week"} className={toggleClass(viewMode === "week")}>
          Week
        </button>
      </div>
      <input
        type="date"
        value={date}
        onChange={(event) => {
          if (event.target.value) {
            jumpToDate(event.target.value);
          }
        }}
        aria-label={viewMode === "day" ? "Jump to date" : "Jump to week containing date"}
        className={DATE_INPUT_CLASS}
      />
    </div>
  );
}
