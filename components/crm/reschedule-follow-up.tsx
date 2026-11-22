"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DATE_INPUT_CLASS } from "@/components/dashboard/preset-range-select";
import { cn } from "@/lib/utils";

// ISO date + n days (calendar dates, no time zone shift).
function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Reschedule a guest's next follow-up to a date. The cadence picks up again
// from their next text, email, call or visit. Opens a small panel under the
// button: one-tap choices (tomorrow, in 3 days, next week) or any date.
export function RescheduleFollowUp({
  contactId,
  today,
  current,
  compact = false,
}: {
  contactId: string;
  // ISO date in the club's timezone; the earliest allowed.
  today: string;
  current: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current && current >= today ? current : today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape or a click outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpOn: date }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't reschedule.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reschedule.");
    } finally {
      setBusy(false);
    }
  }

  const choices = [
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "In 3 days", value: addDays(today, 3) },
    { label: "Next week", value: addDays(today, 7) },
  ];

  return (
    <div ref={panel} className="relative inline-block">
      <Button size="xs" variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <CalendarClock /> {compact ? "Reschedule" : "Reschedule follow-up"}
      </Button>
      {open ? (
        <form
          onSubmit={save}
          role="dialog"
          aria-label="Reschedule follow-up"
          className="absolute top-full left-0 z-30 mt-2 w-72 space-y-3 rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <p className="text-sm font-semibold">Follow up on…</p>
          <div className="grid grid-cols-3 gap-1.5">
            {choices.map((choice) => (
              <button
                key={choice.label}
                type="button"
                aria-pressed={date === choice.value}
                onClick={() => setDate(choice.value)}
                className={cn(
                  "min-h-12 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
                  date === choice.value ? "border-primary bg-primary-subtle" : "hover:border-primary/60",
                )}
              >
                <span className="block font-semibold">{choice.label}</span>
                <span className="block text-muted-foreground">{shortDay(choice.value)}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Or pick a date
            <input
              type="date"
              className={DATE_INPUT_CLASS}
              min={today}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={busy || !date}>
              {busy ? "Saving…" : `Hold until ${shortDay(date)}`}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
