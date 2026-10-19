"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const DATE_INPUT_CLASS =
  "h-8 rounded-md border border-input bg-card px-2.5 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

type PresetRangeSelectProps = {
  presets: { value: string; label: string }[];
  // The three searchParams this control drives, e.g. range/rangeStart/rangeEnd.
  paramNames: { preset: string; start: string; end: string };
  value: string;
  start: string;
  end: string;
  ariaLabel: string;
  // Optional muted prefix shown inside the trigger, e.g. "Compare to".
  prefix?: string;
  className?: string;
};

// Shared searchParams-driven "preset or custom date range" picker. Every
// preset except "custom" clears the explicit dates; "custom" keeps whatever
// dates are current and reveals two date inputs. Used by Overview's time
// frame, Classes' comparison window, and the other report pages.
export function PresetRangeSelect({
  presets,
  paramNames,
  value,
  start,
  end,
  ariaLabel,
  prefix,
  className,
}: PresetRangeSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, nextValue]) => {
      if (nextValue) {
        params.set(key, nextValue);
      } else {
        params.delete(key);
      }
    });
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleChange(nextValue: string) {
    if (nextValue === "custom") {
      updateParams({ [paramNames.preset]: "custom", [paramNames.start]: start, [paramNames.end]: end });
    } else {
      updateParams({ [paramNames.preset]: nextValue, [paramNames.start]: undefined, [paramNames.end]: undefined });
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2", className)}>
      {value === "custom" ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Start date"
            value={start}
            onChange={(event) =>
              updateParams({ [paramNames.preset]: "custom", [paramNames.start]: event.target.value, [paramNames.end]: end })
            }
            className={DATE_INPUT_CLASS}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            aria-label="End date"
            value={end}
            onChange={(event) =>
              updateParams({ [paramNames.preset]: "custom", [paramNames.start]: start, [paramNames.end]: event.target.value })
            }
            className={DATE_INPUT_CLASS}
          />
        </div>
      ) : null}

      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger aria-label={ariaLabel} className="min-w-[180px] bg-card">
          <span className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
