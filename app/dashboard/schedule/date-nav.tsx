"use client";

import { DateTime } from "luxon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DATE_INPUT_CLASS } from "@/components/dashboard/preset-range-select";

type DateNavProps = {
  date: string;
  today: string;
};

export function DateNav({ date, today }: DateNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", newDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  function shiftDate(days: number) {
    const next = DateTime.fromISO(date).plus({ days }).toISODate();
    if (next) {
      navigate(next);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => navigate(today)} disabled={date === today}>
          Today
        </Button>
        <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Next day">
          <ChevronRight />
        </Button>
      </div>
      <input
        type="date"
        value={date}
        aria-label="Jump to date"
        onChange={(event) => {
          if (event.target.value) {
            navigate(event.target.value);
          }
        }}
        className={DATE_INPUT_CLASS}
      />
    </div>
  );
}
