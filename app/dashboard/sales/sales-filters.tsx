"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Funnel, UserRound } from "lucide-react";
import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_TYPES } from "@/lib/crm/labels";

const PRESETS = [
  { value: "mtd", label: "Month to date" },
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Pick dates" },
];

export function SalesFilters({
  range,
  start,
  end,
  seller,
  leadType,
  salespeople,
}: {
  range: string;
  start: string;
  end: string;
  seller: string;
  leadType: string;
  // null for salespeople, who only see their own numbers.
  salespeople: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(name: "seller" | "type", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(name);
    else params.set(name, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <PresetRangeSelect
        presets={PRESETS}
        paramNames={{ preset: "range", start: "start", end: "end" }}
        value={range}
        start={start}
        end={end}
        ariaLabel="Time frame"
      />
      <Select value={leadType} onValueChange={(value) => setParam("type", value)}>
        <SelectTrigger aria-label="Lead type" className="min-w-[170px] bg-card">
          <span className="flex items-center gap-2">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="all">All lead types</SelectItem>
          {LEAD_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {salespeople ? (
        <Select value={seller} onValueChange={(value) => setParam("seller", value)}>
          <SelectTrigger aria-label="Salesperson" className="min-w-[170px] bg-card">
            <span className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">Whole club</SelectItem>
            {salespeople.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
