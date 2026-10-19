import { cn } from "@/lib/utils";

// "9 / 12" with a thin capacity bar underneath. Used anywhere a class's
// bookings-vs-capacity is shown in a table.
export function FillMeter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className={cn("flex min-w-[72px] flex-col items-end gap-1", className)}>
      <span className="text-sm tabular-nums">
        {value}
        <span className="text-muted-foreground"> / {max}</span>
      </span>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className={cn("block h-full rounded-full", pct >= 100 ? "bg-chart-3" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

// Current fill rate vs. the slot's usual fill rate. Green when meaningfully
// above usual, amber when meaningfully below, neutral otherwise -- a
// 10-point band so ordinary week-to-week noise doesn't light everything up.
export function FillVsUsual({
  current,
  usual,
  comparedCount,
}: {
  current: number;
  usual: number | null;
  comparedCount: number;
}) {
  const delta = usual === null ? null : current - usual;
  const tone =
    delta === null || Math.abs(delta) < 10
      ? "text-foreground"
      : delta > 0
        ? "text-emerald-700"
        : "text-amber-700";

  return (
    <div className="flex flex-col items-end gap-0.5" title={comparedCount > 0 ? `Usual is averaged over ${comparedCount} past classes in this slot` : undefined}>
      <span className={cn("text-sm font-medium tabular-nums", tone)}>{current}%</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {usual === null ? "no history" : `usual ${usual}%`}
      </span>
    </div>
  );
}
