"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Pick dates" },
  { value: "all", label: "All" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Active leads & guests" },
  { value: "not_interested", label: "Not interested" },
  { value: "all", label: "Everyone" },
];

export function GuestFilters({
  range,
  start,
  end,
  seller,
  status,
  salespeople,
}: {
  range: string;
  start: string;
  end: string;
  seller: string;
  status: string;
  salespeople: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === fallback) params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PresetRangeSelect
        presets={RANGE_PRESETS}
        paramNames={{ preset: "range", start: "start", end: "end" }}
        value={range}
        start={start}
        end={end}
        ariaLabel="Date range"
        className="justify-start"
      />
      <Select value={seller} onValueChange={(value) => set("seller", value, "all")}>
        <SelectTrigger aria-label="Salesperson" className="min-w-[180px] bg-card">
          <span className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All salespeople</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {salespeople.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(value) => set("status", value, "open")}>
        <SelectTrigger aria-label="Status" className="min-w-[180px] bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
