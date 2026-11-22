"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Guest = { id: string; name: string; status: string; phoneLast4: string | null; assignedStaffId: string | null };

const UNASSIGNED = "__none__";

// Times offered as one-tap buttons (any other time: "Other time").
const SLOTS = Array.from({ length: 29 }, (_, index) => {
  const minutes = 6 * 60 + index * 30; // 6:00 AM to 8:00 PM
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

// "17:30" -> "5:30 PM"
function timeLabel(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// ISO date -> the 7 days starting there (calendar dates, no time zone shift).
function weekFrom(iso: string): { iso: string; dow: string; num: number }[] {
  const [year, month, day] = iso.split("-").map(Number);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return {
      iso: date.toISOString().slice(0, 10),
      dow: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      num: date.getUTCDate(),
    };
  });
}

function longDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const sectionLabel = "mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase";

// Book an appointment from the calendar: pick the guest (search by name),
// then the date and time, then who they're meeting. The same booking as the
// guest profile's Appointments card (POST /api/crm/contacts/[id]/appointments).
export function AddAppointmentButton({
  date,
  today,
  salespeople,
  currentStaffId,
  compact = false,
}: {
  // ISO date the dialog starts on (the day clicked, or the day in view).
  date: string;
  today: string;
  salespeople: { id: string; name: string }[];
  currentStaffId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Guest[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [day, setDay] = useState(date < today ? today : date);
  const [time, setTime] = useState("10:00");
  const [staffId, setStaffId] = useState(currentStaffId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strip = weekFrom(date < today ? today : date);

  // Search as they type (after a short pause).
  useEffect(() => {
    if (!open || guest) return;
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch("/api/crm/contacts/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: query }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        setResults(result.success ? (result.results as Guest[]) : []);
      } catch {
        // Aborted by the next keystroke.
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open, guest]);

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setQ("");
    setResults(null);
    setGuest(null);
    setDay(date < today ? today : date);
    setTime("10:00");
    setStaffId(currentStaffId);
    setError(null);
  }

  function pick(picked: Guest) {
    setGuest(picked);
    // Default to their salesperson, else whoever is booking.
    const assigned = salespeople.some((person) => person.id === picked.assignedStaffId);
    setStaffId(assigned ? picked.assignedStaffId! : currentStaffId);
    setError(null);
  }

  async function book(event: React.FormEvent) {
    event.preventDefault();
    if (!guest) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${guest.id}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: `${day}T${time}`, staffId: staffId === UNASSIGNED ? null : staffId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't book the appointment.");
      setOpen(false);
      // Show the day it was booked on.
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", day);
      router.push(`${pathname}?${params.toString()}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book the appointment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label={`Add appointment on ${date}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button size="sm">
            <Plus /> Add appointment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="gap-5 rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Add appointment</DialogTitle>
          <DialogDescription>
            {guest ? `Pick a time for ${guest.name}.` : "Find the guest first. Search by first or last name."}
          </DialogDescription>
        </DialogHeader>

        {!guest ? (
          <div className="space-y-3">
            <Input
              autoFocus
              value={q}
              placeholder="Guest's name"
              autoComplete="off"
              onChange={(event) => setQ(event.target.value)}
            />
            {searching && !results ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
            {results ? (
              results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No guests match. New people can be added from Guests → Add lead.
                </p>
              ) : (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                  {results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => pick(result)}
                      >
                        <span className="font-medium">{result.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {result.phoneLast4 ? `•••${result.phoneLast4}` : ""}
                          {result.status === "member" ? " · member" : ""}
                          {result.status === "not_interested" ? " · not interested" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : (
          <form onSubmit={book} className="space-y-5">
            <div>
              <p className={sectionLabel}>Guest</p>
              <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-bold text-primary"
                  >
                    {initials(guest.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{guest.name}</span>
                    {guest.phoneLast4 ? <span className="block text-xs text-muted-foreground">•••{guest.phoneLast4}</span> : null}
                  </span>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setGuest(null)}>
                  <ArrowLeft /> Change
                </Button>
              </div>
            </div>

            <fieldset>
              <legend className={sectionLabel}>Day</legend>
              <div className="grid grid-cols-7 gap-1.5">
                {strip.map((option) => {
                  const selected = option.iso === day;
                  return (
                    <button
                      key={option.iso}
                      type="button"
                      aria-pressed={selected}
                      aria-label={longDay(option.iso)}
                      onClick={() => setDay(option.iso)}
                      className={cn(
                        "flex min-h-14 flex-col items-center justify-center rounded-xl border text-center transition-colors",
                        selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/60",
                      )}
                    >
                      <span className="text-[11px] font-medium">{option.dow}</span>
                      <span className="font-display text-lg leading-tight font-semibold">{option.num}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Label htmlFor="appointment-day" className="text-xs font-normal text-muted-foreground">
                  Another date
                </Label>
                <Input
                  id="appointment-day"
                  type="date"
                  min={today}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  required
                  className="h-9 w-auto"
                />
              </div>
            </fieldset>

            <fieldset>
              <legend className={sectionLabel}>Time · {longDay(day)}</legend>
              <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-6">
                {SLOTS.map((slot) => {
                  const selected = slot === time;
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setTime(slot)}
                      className={cn(
                        "min-h-10 rounded-lg border text-xs font-semibold tabular-nums transition-colors",
                        selected ? "border-primary bg-primary-subtle text-primary" : "bg-card hover:border-primary/60",
                      )}
                    >
                      {timeLabel(slot)}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Label htmlFor="appointment-time" className="text-xs font-normal text-muted-foreground">
                  Other time
                </Label>
                <Input
                  id="appointment-time"
                  type="time"
                  step={900}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                  className="h-9 w-auto"
                />
              </div>
            </fieldset>

            <fieldset>
              <legend className={sectionLabel}>With</legend>
              <div className="flex flex-wrap gap-2">
                {[...salespeople, { id: UNASSIGNED, name: "No one yet" }].map((person) => {
                  const selected = person.id === staffId;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setStaffId(person.id)}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-sm font-semibold transition-colors",
                        selected ? "border-primary bg-primary-subtle text-primary" : "bg-card hover:border-primary/60",
                      )}
                    >
                      <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">
                        {person.id === UNASSIGNED ? "-" : initials(person.name)}
                      </span>
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm font-semibold">
                {longDay(day)}
                {time ? ` at ${timeLabel(time)}` : ""}
                {staffId !== UNASSIGNED ? ` with ${salespeople.find((person) => person.id === staffId)?.name ?? ""}` : ""}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !day || !time}>
                  {busy ? "Booking…" : "Book appointment"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
