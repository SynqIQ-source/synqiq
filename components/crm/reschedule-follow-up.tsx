"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DATE_INPUT_CLASS } from "@/components/dashboard/preset-range-select";

// Reschedule a guest's next follow-up to a date. The cadence picks up again
// from their next text, email, call or visit.
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
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current && current >= today ? current : today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!open) {
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock /> {compact ? "Reschedule" : "Reschedule follow-up"}
      </Button>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        aria-label="Follow up on"
        className={DATE_INPUT_CLASS}
        min={today}
        value={date}
        onChange={(event) => setDate(event.target.value)}
        required
      />
      <Button size="xs" type="submit" disabled={busy || !date}>
        Save
      </Button>
      <Button size="xs" type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
