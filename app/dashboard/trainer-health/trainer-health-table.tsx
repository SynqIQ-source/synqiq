"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
          <SelectTrigger aria-label="Trainer" className="min-w-[200px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All trainers</SelectItem>
            {trainerHealth.map((row) => (
              <SelectItem key={row.staffId} value={row.staffId}>
                {row.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 border-r bg-card p-3 text-left">Trainer</th>
              {buckets.map((bucket) => (
                <th key={bucket.key} className="p-3 text-right" colSpan={3}>
                  {bucket.label}
                </th>
              ))}
              <th className="border-l bg-muted/50 p-3 text-right" colSpan={3}>
                Year to Date
              </th>
            </tr>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 border-r bg-card p-3 text-left"></th>
              {buckets.map((bucket) => (
                <Fragment key={bucket.key}>
                  <th className="p-3 text-right font-normal">Sessions</th>
                  <th className="p-3 text-right font-normal">Sales</th>
                  <th className="p-3 text-right font-normal">Ratio</th>
                </Fragment>
              ))}
              <th className="border-l bg-muted/50 p-3 text-right font-normal">Sessions</th>
              <th className="bg-muted/50 p-3 text-right font-normal">Sales</th>
              <th className="bg-muted/50 p-3 text-right font-normal">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {trainerHealth.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={1 + buckets.length * 3 + 3}>
                  No trainer activity in the last {monthsShown} months.
                </td>
              </tr>
            ) : (
              <>
                <tr className="border-b bg-muted/50 font-semibold">
                  <td className="sticky left-0 z-10 border-r bg-muted/50 p-3">All Trainers</td>
                  {studioSummary.months.map((month, index) => (
                    <MonthCells key={buckets[index].key} month={month} healthThreshold={healthThreshold} />
                  ))}
                  <MonthCells month={studioSummary.ytd} healthThreshold={healthThreshold} borderLeft shaded />
                </tr>
                {visibleRows.map((row) => (
                  <tr key={row.staffId} className="border-b">
                    <td className="sticky left-0 z-10 min-w-[190px] border-r bg-card p-3 font-medium whitespace-nowrap">
                      {row.displayName}
                      {row.flagged && (
                        <span className="mt-1 block w-fit rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
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
  const bg = shaded ? "bg-muted/50" : "";
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
            ? "font-normal text-muted-foreground"
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
