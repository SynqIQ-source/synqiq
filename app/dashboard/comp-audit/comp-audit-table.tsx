"use client";

import { useMemo, useState } from "react";

export type CompRow = {
  id: string;
  dateOfService: string;
  staffName: string;
  clientName: string;
  pricingOption: string | null;
  className: string | null;
};

type SortKey = "dateOfService" | "staffName" | "clientName" | "pricingOption";
type SortDir = "asc" | "desc";

function sortValue(row: CompRow, key: SortKey): string {
  if (key === "pricingOption") return row.pricingOption ?? "";
  return row[key];
}

function SortHeader({
  label,
  sortKeyName,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKeyName: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKeyName === activeKey;
  return (
    <th className="p-3 text-left">
      <button
        type="button"
        onClick={() => onSort(sortKeyName)}
        className={`flex items-center gap-1 font-medium ${active ? "text-zinc-950" : "text-zinc-500"}`}
      >
        {label}
        <span className="text-xs">{active ? (dir === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

// Counted against the full, unfiltered dataset -- this is the actual
// pattern-detection signal (how many times has this staff/client shown up
// across every $0-on-capped row on record), so it stays stable regardless
// of the current filter selection instead of trivially reading "100%" the
// moment someone filters down to one staff member.
function buildCounts(rows: CompRow[], key: "staffName" | "clientName"): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function CompAuditTable({ rows }: { rows: CompRow[] }) {
  const [staffFilter, setStaffFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dateOfService");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const staffCounts = useMemo(() => buildCounts(rows, "staffName"), [rows]);
  const clientCounts = useMemo(() => buildCounts(rows, "clientName"), [rows]);

  const staffOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.staffName))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const clientQuery = clientFilter.trim().toLowerCase();
    return rows.filter((row) => {
      if (staffFilter !== "all" && row.staffName !== staffFilter) return false;
      if (clientQuery && !row.clientName.toLowerCase().includes(clientQuery)) return false;
      return true;
    });
  }, [rows, staffFilter, clientFilter]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => sortValue(a, sortKey).localeCompare(sortValue(b, sortKey)));
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [filteredRows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No $0-on-a-capped-package rows found -- nothing to review here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Staff
          <select
            value={staffFilter}
            onChange={(event) => setStaffFilter(event.target.value)}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
          >
            <option value="all">All staff</option>
            {staffOptions.map((name) => (
              <option key={name} value={name}>
                {name} ({staffCounts.get(name)})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Client
          <input
            type="text"
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
            placeholder="Search client name..."
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
          />
        </label>

        <p className="text-sm text-zinc-500">
          Showing {sortedRows.length} of {rows.length} row(s)
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <SortHeader label="Date" sortKeyName="dateOfService" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Staff" sortKeyName="staffName" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Client" sortKeyName="clientName" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader
                label="Pricing Option"
                sortKeyName="pricingOption"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
              />
              <th className="p-3 text-left font-medium">Class</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const staffRepeatCount = staffCounts.get(row.staffName) ?? 1;
              const clientRepeatCount = clientCounts.get(row.clientName) ?? 1;
              return (
                <tr key={row.id} className="border-b">
                  <td className="p-3 text-zinc-600">{row.dateOfService}</td>
                  <td className="p-3">
                    {row.staffName}
                    {staffRepeatCount > 1 && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        ×{staffRepeatCount}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {row.clientName}
                    {clientRepeatCount > 1 && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        ×{clientRepeatCount}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-zinc-600">{row.pricingOption ?? "--"}</td>
                  <td className="p-3 text-zinc-600">{row.className ?? "--"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-5 text-zinc-500">
        A <span className="font-medium text-zinc-600">×N</span> badge means that staff member or
        client appears in N of the {rows.length} total $0 rows on record (not just the current
        filter) -- a repeated pattern worth a closer look.
      </p>
    </div>
  );
}
