"use client";

import { Fragment, useState } from "react";
import type { MonthStat, TrainerHealth } from "./page";

type BucketLabel = { key: string; label: string };

type TrainerHealthTableProps = {
  buckets: BucketLabel[];
  trainerHealth: TrainerHealth[];
  studioSummary: { months: MonthStat[]; ytd: MonthStat };
  healthThreshold: number;
  monthsShown: number;
};

export function TrainerHealthTable({
  buckets,
  trainerHealth,
  studioSummary,
  healthThreshold,
  monthsShown,
}: TrainerHealthTableProps) {
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");

  const visibleRows =
    selectedStaffId === "all" ? trainerHealth : trainerHealth.filter((row) => row.staffId === selectedStaffId);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="trainer-select">
          Trainer
        </label>
        <select
          id="trainer-select"
          value={selectedStaffId}
          onChange={(event) => setSelectedStaffId(event.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        >
          <option value="all">All trainers</option>
          {trainerHealth.map((row) => (
            <option key={row.staffId} value={row.staffId}>
              {row.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 border-r bg-white p-3 text-left">Trainer</th>
              {buckets.map((bucket) => (
                <th key={bucket.key} className="p-3 text-right" colSpan={3}>
                  {bucket.label}
                </th>
              ))}
              <th className="border-l bg-zinc-50 p-3 text-right" colSpan={3}>
                Year to Date
              </th>
            </tr>
            <tr className="border-b text-xs text-zinc-500">
              <th className="sticky left-0 z-10 border-r bg-white p-3 text-left"></th>
              {buckets.map((bucket) => (
                <Fragment key={bucket.key}>
                  <th className="p-3 text-right font-normal">Sessions</th>
                  <th className="p-3 text-right font-normal">Sales</th>
                  <th className="p-3 text-right font-normal">Ratio</th>
                </Fragment>
              ))}
              <th className="border-l bg-zinc-50 p-3 text-right font-normal">Sessions</th>
              <th className="bg-zinc-50 p-3 text-right font-normal">Sales</th>
              <th className="bg-zinc-50 p-3 text-right font-normal">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {trainerHealth.length === 0 ? (
              <tr>
                <td className="p-3 text-zinc-500" colSpan={1 + buckets.length * 3 + 3}>
                  No trainer activity in the last {monthsShown} months.
                </td>
              </tr>
            ) : (
              <>
                <tr className="border-b bg-zinc-50 font-semibold">
                  <td className="sticky left-0 z-10 border-r bg-zinc-50 p-3">All Trainers</td>
                  {studioSummary.months.map((month, index) => (
                    <MonthCells key={buckets[index].key} month={month} healthThreshold={healthThreshold} />
                  ))}
                  <MonthCells month={studioSummary.ytd} healthThreshold={healthThreshold} borderLeft shaded />
                </tr>
                {visibleRows.map((row) => (
                  <tr key={row.staffId} className="border-b">
                    <td className="sticky left-0 z-10 border-r bg-white p-3 font-medium">
                      {row.displayName}
                      {row.flagged && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Under benchmark
                        </span>
                      )}
                    </td>
                    {row.months.map((month, index) => (
                      <MonthCells key={buckets[index].key} month={month} healthThreshold={healthThreshold} />
                    ))}
                    <MonthCells month={row.ytd} healthThreshold={healthThreshold} borderLeft shaded />
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthCells({
  month,
  healthThreshold,
  borderLeft,
  shaded,
}: {
  month: MonthStat;
  healthThreshold: number;
  borderLeft?: boolean;
  shaded?: boolean;
}) {
  const bg = shaded ? "bg-zinc-50" : "";
  return (
    <>
      <td className={`p-3 text-right ${borderLeft ? "border-l" : ""} ${bg}`}>{month.sessions}</td>
      <td className={`p-3 text-right ${bg}`}>
        {month.salesTotal > 0
          ? `$${month.salesTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : "--"}
      </td>
      <td
        className={`p-3 text-right font-medium ${bg} ${
          month.ratio === null
            ? "font-normal text-zinc-400"
            : month.ratio < healthThreshold
              ? "text-red-600"
              : "text-green-700"
        }`}
      >
        {month.ratio !== null ? `${(month.ratio * 100).toFixed(0)}%` : "N/A"}
      </td>
    </>
  );
}
