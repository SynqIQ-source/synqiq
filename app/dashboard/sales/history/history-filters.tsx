"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Funnel, UserRound } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_TYPES } from "@/lib/crm/labels";

export function HistoryFilters({
  months,
  seller,
  leadType,
  salespeople,
}: {
  months: string;
  seller: string;
  leadType: string;
  // null for salespeople, who only see their own numbers.
  salespeople: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(name: "months" | "seller" | "type", value: string, fallback: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === fallback) params.delete(name);
    else params.set(name, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select value={months} onValueChange={(value) => setParam("months", value, "12")}>
        <SelectTrigger aria-label="Months" className="min-w-[160px] bg-card">
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="6">Last 6 months</SelectItem>
          <SelectItem value="12">Last 12 months</SelectItem>
          <SelectItem value="24">Last 24 months</SelectItem>
        </SelectContent>
      </Select>
      <Select value={leadType} onValueChange={(value) => setParam("type", value, "all")}>
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
        <Select value={seller} onValueChange={(value) => setParam("seller", value, "all")}>
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
