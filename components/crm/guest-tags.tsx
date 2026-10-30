import {
  APPOINTMENT_OUTCOME_LABELS,
  LEAD_TYPES,
  LEAD_TYPE_TAGS,
  leadTypeOf,
  type AppointmentOutcome,
} from "@/lib/crm/labels";
import { cn } from "@/lib/utils";

// "WI", "GM", "REF"... next to a guest's name, with the full lead type on hover.
export function LeadTypeTag({
  contact,
  className,
}: {
  contact: { source: string; referring_client_id: string | null; referrer_name_typed: string | null };
  className?: string;
}) {
  const type = leadTypeOf(contact);
  return (
    <span
      title={LEAD_TYPES.find((item) => item.value === type)?.label}
      className={cn(
        "inline-flex items-center rounded border px-1 text-[10px] leading-4 font-semibold tracking-wide text-muted-foreground",
        className,
      )}
    >
      {LEAD_TYPE_TAGS[type]}
    </span>
  );
}

// Colors for an appointment's outcome: the chip on the calendar, and a dot
// in lists and the legend.
export const OUTCOME_CHIP_CLASSES: Record<AppointmentOutcome, string> = {
  scheduled: "border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-100",
  no_show: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  showed: "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100",
  closed:
    "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100",
  canceled: "border-dashed border-zinc-300 bg-transparent text-muted-foreground line-through dark:border-zinc-700",
};

const DOT_CLASSES: Record<AppointmentOutcome, string> = {
  scheduled: "bg-blue-500",
  no_show: "bg-zinc-400",
  showed: "bg-red-500",
  closed: "bg-emerald-500",
  canceled: "border border-zinc-400 bg-transparent",
};

export function OutcomeDot({ outcome, className }: { outcome: AppointmentOutcome; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", DOT_CLASSES[outcome], className)} />;
}

export function OutcomeLabel({ outcome }: { outcome: AppointmentOutcome }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <OutcomeDot outcome={outcome} />
      {APPOINTMENT_OUTCOME_LABELS[outcome]}
    </span>
  );
}

export function OutcomeLegend({ outcomes }: { outcomes: AppointmentOutcome[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {outcomes.map((outcome) => (
        <OutcomeLabel key={outcome} outcome={outcome} />
      ))}
    </div>
  );
}
