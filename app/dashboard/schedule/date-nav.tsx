"use client";

import { DateTime } from "luxon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type DateNavProps = {
  date: string;
};

export function DateNav({ date }: DateNavProps) {
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => shiftDate(-1)}
        aria-label="Previous day"
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        &lsaquo;
      </button>
      <input
        type="date"
        value={date}
        onChange={(event) => {
          if (event.target.value) {
            navigate(event.target.value);
          }
        }}
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
      />
      <button
        type="button"
        onClick={() => shiftDate(1)}
        aria-label="Next day"
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        &rsaquo;
      </button>
    </div>
  );
}
