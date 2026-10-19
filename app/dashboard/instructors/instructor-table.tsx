"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { InstructorStat } from "./page";

type SortKey = "displayName" | "scheduled" | "fillRatePct" | "released" | "pickedUp";
type SortDirection = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "displayName", label: "Instructor", align: "left" },
  { key: "scheduled", label: "Classes taught", align: "right" },
  { key: "fillRatePct", label: "Avg fill rate", align: "right" },
  { key: "released", label: "Released", align: "right" },
  { key: "pickedUp", label: "Picked up", align: "right" },
];

// Default sort matches the server's own pre-sort (scheduled, descending) so
// the initial render needs no client-side re-sort to look correct.
export function InstructorTable({ rows }: { rows: InstructorStat[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("scheduled");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      // null only ever occurs on fillRatePct (no capacity data yet) -- always
      // sinks to the bottom regardless of sort direction.
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
  }, [rows, sortKey, sortDirection]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "displayName" ? "asc" : "desc");
    }
  }

  const maxScheduled = Math.max(1, ...rows.map((row) => row.scheduled));

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          {COLUMNS.map((column) => {
            const active = sortKey === column.key;
            const Icon = !active ? ArrowUpDown : sortDirection === "asc" ? ArrowUp : ArrowDown;
            return (
              <TableHead
                key={column.key}
                className={cn(column.align === "right" ? "text-right" : "pl-4", "last:pr-4")}
                aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
              >
                <button
                  type="button"
                  onClick={() => handleSort(column.key)}
                  className={cn(
                    "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {column.label}
                  <Icon className={cn("h-3.5 w-3.5", !active && "opacity-50")} />
                </button>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.length === 0 ? (
          <TableRow>
            <TableCell className="p-8 text-center text-muted-foreground" colSpan={COLUMNS.length}>
              No instructor activity in this time frame.
            </TableCell>
          </TableRow>
        ) : (
          sortedRows.map((row) => (
            <TableRow key={row.staffId}>
              <TableCell className="pl-4 font-medium">{row.displayName}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${(row.scheduled / maxScheduled) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 tabular-nums">{row.scheduled}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.fillRatePct !== null ? `${row.fillRatePct.toFixed(1)}%` : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.released || <Muted />}</TableCell>
              <TableCell className="pr-4 text-right tabular-nums">{row.pickedUp || <Muted />}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function Muted() {
  return <span className="text-muted-foreground">0</span>;
}
