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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Guest = { id: string; name: string; status: string; phoneLast4: string | null; assignedStaffId: string | null };

const UNASSIGNED = "__none__";

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add appointment</DialogTitle>
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
          <form onSubmit={book} className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{guest.name}</span>
              <Button type="button" size="xs" variant="ghost" onClick={() => setGuest(null)}>
                <ArrowLeft /> Change
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="appointment-day">Date</Label>
                <Input
                  id="appointment-day"
                  type="date"
                  min={today}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appointment-time">Time</Label>
                <Input
                  id="appointment-time"
                  type="time"
                  step={900}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>With</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {salespeople.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNASSIGNED}>No one yet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !day || !time}>
                {busy ? "Booking…" : "Book appointment"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
