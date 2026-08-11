"use client";

import { useMemo, useState } from "react";
import type { InstructorStat } from "./page";

type SortKey = "displayName" | "scheduled" | "fillRatePct" | "released" | "pickedUp";
type SortDirection = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "displayName", label: "Instructor", align: "left" },
  { key: "scheduled", label: "Classes Scheduled", align: "right" },
  { key: "fillRatePct", label: "Avg Fill Rate", align: "right" },
  { key: "released", label: "Released for Coverage", align: "right" },
  { key: "pickedUp", label: "Picked Up as Sub", align: "right" },
];

// Default sort matches the server's own pre-sort (scheduled, descending) so
// the initial render needs no client-side re-sort to look correct.
export function InstructorTable({ rows }: { rows: InstructorStat[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("scheduled");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    const withNullsLast = [...rows].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      // null only ever occurs on fillRatePct (no capacity data yet) -- always
      // sinks to the bottom regardless of sort direction, rather than
      // flip-flopping to the top on "ascending".
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }

      const numericA = aValue as number;
      const numericB = bValue as number;
      return sortDirection === "asc" ? numericA - numericB : numericB - numericA;
    });

    return withNullsLast;
  }, [rows, sortKey, sortDirection]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "displayName" ? "asc" : "desc");
    }
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {COLUMNS.map((column) => (
              <th key={column.key} className={`p-3 ${column.align === "right" ? "text-right" : "text-left"}`}>
                <button
                  type="button"
                  onClick={() => handleSort(column.key)}
                  className="inline-flex items-center gap-1 font-medium text-zinc-950 hover:text-zinc-600"
                >
                  {column.label}
                  <SortIndicator active={sortKey === column.key} direction={sortDirection} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td className="p-3 text-zinc-500" colSpan={COLUMNS.length}>
                No instructor activity in this window.
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => (
              <tr key={row.staffId} className="border-b">
                <td className="p-3 font-medium">{row.displayName}</td>
                <td className="p-3 text-right">{row.scheduled}</td>
                <td className="p-3 text-right">
                  {row.fillRatePct !== null ? `${row.fillRatePct.toFixed(1)}%` : "N/A"}
                </td>
                <td className="p-3 text-right">{row.released}</td>
                <td className="p-3 text-right">{row.pickedUp}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <span className="text-zinc-300">↕</span>;
  }
  return <span className="text-zinc-950">{direction === "asc" ? "↑" : "↓"}</span>;
}
