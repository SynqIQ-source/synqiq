"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type WeekNavProps = {
  weekStartIso: string;
  prevWeekStartIso: string;
  nextWeekStartIso: string;
  currentWeekStartIso: string;
  // The week the page shows with no ?week= param (the last full week).
  defaultWeekStartIso: string;
  weekLabel: string;
};

// searchParams-driven, same push-based pattern as RoomSelect/RangeSelect on
// this page. "Next" is disabled on the current week -- classes after it
// haven't happened yet, and this page only counts classes that have.
export function WeekNav({
  weekStartIso,
  prevWeekStartIso,
  nextWeekStartIso,
  currentWeekStartIso,
  defaultWeekStartIso,
  weekLabel,
}: WeekNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCurrentWeek = weekStartIso === currentWeekStartIso;

  function goToWeek(nextWeekStart: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextWeekStart === defaultWeekStartIso) {
      params.delete("week");
    } else {
      params.set("week", nextWeekStart);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => goToWeek(prevWeekStartIso)} aria-label="Previous week">
        <ChevronLeft />
      </Button>
      <span className="min-w-[10.5rem] text-center text-sm font-semibold">{weekLabel}</span>
      <Button
        variant="outline"
        size="icon"
        onClick={() => goToWeek(nextWeekStartIso)}
        disabled={isCurrentWeek}
        aria-label="Next week"
      >
        <ChevronRight />
      </Button>
      {!isCurrentWeek ? (
        <Button variant="ghost" onClick={() => goToWeek(currentWeekStartIso)}>
          This week
        </Button>
      ) : null}
    </div>
  );
}
