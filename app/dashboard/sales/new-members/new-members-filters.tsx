"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dumbbell } from "lucide-react";
import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PRESETS = [
  { value: "mtd", label: "This month" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Pick dates" },
];

export function NewMembersFilters({
  range,
  start,
  end,
  trainer,
  trainers,
}: {
  range: string;
  start: string;
  end: string;
  trainer: string;
  trainers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setTrainer(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("trainer");
    else params.set("trainer", value);
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
        ariaLabel="Enrolled"
      />
      <Select value={trainer} onValueChange={setTrainer}>
        <SelectTrigger aria-label="Trainer" className="min-w-[170px] bg-card">
          <span className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="all">All trainers</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {trainers.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
