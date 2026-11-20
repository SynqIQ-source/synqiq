"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DAY_NAMES } from "@/lib/classes/catalog";

export type StaffOption = { id: string; name: string };
export type RoomOption = { id: string; name: string; layouts: { id: string; name: string; isDefault: boolean }[] };
type TimeRow = {
  days: number[];
  startTime: string;
  endTime: string;
  everyWeeks: number;
  staffId: string;
  assistantId: string;
  pay: string; // dollars; blank = their Pay Rates rate
  assistantPay: string;
  roomId: string;
  layoutId: string;
};
export type ExistingSeries = {
  scheduleId: string;
  days: number[];
  startTime: string;
  endTime: string;
  everyWeeks: number;
  staffId: string | null;
  assistantId: string | null;
  payCents: number | null;
  assistantPayCents: number | null;
  roomId: string | null;
  layoutId: string | null;
  capacity: number | null;
  waitlist: number | null;
  online: number | null;
  isFree: boolean;
  payLater: boolean;
  endDate: string | null;
};
type Preview = {
  dates: { date: string; start: string; end: string }[];
  total: number;
  clashes: { date: string; time: string; with: string; reason: string }[];
};

const plusMinutes = (time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const cents = (dollars: string) => (dollars.trim() === "" ? null : Math.round(Number(dollars.replace(/[$,\s]/g, "")) * 100));
const dollars = (value: number | null) => (value === null ? "" : (value / 100).toFixed(2).replace(/\.00$/, ""));
const prettyDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const prettyTime = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/class-schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string } & Partial<Preview>;
  if (!response.ok || !json.success) throw new Error(json.error ?? "Couldn't save. Try again.");
  return json;
}

// Schedule a class (new series), or change one "from a date on".
export function ScheduleEditorDialog({
  classTypeId,
  className,
  today,
  instructors,
  rooms,
  defaults,
  series,
}: {
  classTypeId: string;
  className: string;
  today: string;
  instructors: StaffOption[];
  rooms: RoomOption[];
  defaults: { minutes: number | null; roomId: string | null; capacity: number | null; waitlist: number | null; online: number | null };
  series?: ExistingSeries; // set: change this series from a date on
}) {
  const router = useRouter();
  const blankRow = (): TimeRow => ({
    days: series?.days ?? [],
    startTime: series?.startTime.slice(0, 5) ?? "",
    endTime: series?.endTime.slice(0, 5) ?? "",
    everyWeeks: series?.everyWeeks ?? 1,
    staffId: series?.staffId ?? "",
    assistantId: series?.assistantId ?? "",
    pay: dollars(series?.payCents ?? null),
    assistantPay: dollars(series?.assistantPayCents ?? null),
    roomId: series?.roomId ?? defaults.roomId ?? "",
    layoutId: series?.layoutId ?? "",
  });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"recurring" | "single">("recurring");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(series?.endDate ?? "");
  const [rows, setRows] = useState<TimeRow[]>([blankRow()]);
  const [capacity, setCapacity] = useState(String(series?.capacity ?? defaults.capacity ?? ""));
  const [waitlist, setWaitlist] = useState(
    series?.waitlist === undefined ? String(defaults.waitlist ?? "") : String(series.waitlist ?? ""),
  );
  const [onlineBooking, setOnlineBooking] = useState((series ? series.online : defaults.online) !== 0);
  const [onlineCapacity, setOnlineCapacity] = useState(() => {
    const value = series ? series.online : defaults.online;
    return value === null || value === 0 ? "" : String(value);
  });
  const [isFree, setIsFree] = useState(series?.isFree ?? false);
  const [payLater, setPayLater] = useState(series?.payLater ?? false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (index: number, patch: Partial<TimeRow>) => {
    setPreview(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const payload = () => ({
    classTypeId,
    kind,
    startDate,
    fromDate: startDate,
    scheduleId: series?.scheduleId,
    endDate: kind === "single" ? null : endDate || null,
    capacity: capacity === "" ? null : Number(capacity),
    waitlistCapacity: waitlist === "" ? null : Number(waitlist),
    onlineBooking,
    onlineCapacity: onlineCapacity === "" ? null : Number(onlineCapacity),
    isFree,
    payLater,
    rows: rows.map((row) => ({
      days: row.days,
      startTime: row.startTime,
      endTime: row.endTime,
      everyWeeks: row.everyWeeks,
      staffId: row.staffId || null,
      assistantId: row.assistantId || null,
      payOverrideCents: cents(row.pay),
      assistantPayCents: row.assistantId ? cents(row.assistantPay) : null,
      roomId: row.roomId || null,
      layoutId: row.layoutId || null,
    })),
  });
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await post({ ...payload(), action: "preview" });
      setPreview({ dates: result.dates ?? [], total: result.total ?? 0, clashes: result.clashes ?? [] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't check.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post({ ...payload(), action: series ? "split" : "create" });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  const select = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRows([blankRow()]);
          setStartDate(today);
          setPreview(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {series ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2">
            <Pencil /> Change
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm">
            <CalendarPlus /> Schedule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{series ? `Change ${className}` : `Schedule ${className}`}</DialogTitle>
          <DialogDescription>
            {series
              ? "Dates before the change stay as they are; the new times start on the date you pick."
              : "No end date needed: it runs until you end it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {series ? null : (
            <div className="flex gap-2">
              {(["recurring", "single"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={kind === option ? "default" : "outline"}
                  onClick={() => setKind(option)}
                >
                  {option === "recurring" ? "Recurring class" : "Single class"}
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="series-start">{series ? "Changes start on" : kind === "single" ? "Date" : "Start date"}</Label>
              <Input id="series-start" type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            {kind === "recurring" ? (
              <div className="space-y-1.5">
                <Label htmlFor="series-end">End date (optional)</Label>
                <Input id="series-end" type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            ) : null}
          </div>

          {rows.map((row, index) => {
            const room = rooms.find((option) => option.id === row.roomId);
            return (
              <div key={index} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{rows.length > 1 ? `Time ${index + 1}` : "Time"}</p>
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 /> <span className="sr-only">Remove</span>
                    </Button>
                  ) : null}
                </div>
                {kind === "recurring" ? (
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const on = row.days.includes(day);
                      return (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          onClick={() => setRow(index, { days: on ? row.days.filter((item) => item !== day) : [...row.days, day] })}
                        >
                          {DAY_NAMES[day]}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input
                      type="time"
                      value={row.startTime}
                      onChange={(event) =>
                        setRow(index, {
                          startTime: event.target.value,
                          endTime: row.endTime || !defaults.minutes ? row.endTime : plusMinutes(event.target.value, defaults.minutes),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input type="time" value={row.endTime} onChange={(event) => setRow(index, { endTime: event.target.value })} />
                  </div>
                  {kind === "recurring" ? (
                    <div className="space-y-1.5">
                      <Label>Repeats every</Label>
                      <select
                        className={select}
                        value={row.everyWeeks}
                        onChange={(event) => setRow(index, { everyWeeks: Number(event.target.value) })}
                      >
                        {[1, 2, 3, 4].map((weeks) => (
                          <option key={weeks} value={weeks}>
                            {weeks === 1 ? "week" : `${weeks} weeks`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Instructor</Label>
                    <select className={select} value={row.staffId} onChange={(event) => setRow(index, { staffId: event.target.value })}>
                      <option value="">—</option>
                      {instructors.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pay (optional)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="Their Pay Rates rate"
                      value={row.pay}
                      onChange={(event) => setRow(index, { pay: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Assistant (optional)</Label>
                    <select
                      className={select}
                      value={row.assistantId}
                      onChange={(event) => setRow(index, { assistantId: event.target.value })}
                    >
                      <option value="">None</option>
                      {instructors
                        .filter((option) => option.id !== row.staffId)
                        .map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  {row.assistantId ? (
                    <div className="space-y-1.5">
                      <Label>Assistant pay</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="Their Pay Rates rate (0 = unpaid)"
                        value={row.assistantPay}
                        onChange={(event) => setRow(index, { assistantPay: event.target.value })}
                      />
                    </div>
                  ) : (
                    <div />
                  )}
                  <div className="space-y-1.5">
                    <Label>Room</Label>
                    <select
                      className={select}
                      value={row.roomId}
                      onChange={(event) => setRow(index, { roomId: event.target.value, layoutId: "" })}
                    >
                      <option value="">—</option>
                      {rooms.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {room?.layouts.length ? (
                    <div className="space-y-1.5">
                      <Label>Spot layout</Label>
                      <select className={select} value={row.layoutId} onChange={(event) => setRow(index, { layoutId: event.target.value })}>
                        <option value="">The room&apos;s usual layout</option>
                        {room.layouts.map((layout) => (
                          <option key={layout.id} value={layout.id}>
                            {layout.name}
                            {layout.isDefault ? " (main)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {series ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { ...blankRow(), days: [] }])}>
              <Plus /> Add another time
            </Button>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="series-capacity">Spots</Label>
              <Input id="series-capacity" type="number" min={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="series-waitlist">Waitlist size</Label>
              <Input
                id="series-waitlist"
                type="number"
                min={0}
                placeholder="No limit"
                value={waitlist}
                onChange={(event) => setWaitlist(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="series-online">Spots bookable online</Label>
              <Input
                id="series-online"
                type="number"
                min={0}
                placeholder="All"
                disabled={!onlineBooking}
                value={onlineCapacity}
                onChange={(event) => setOnlineCapacity(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={onlineBooking} onCheckedChange={setOnlineBooking} /> Members can book online
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={isFree} onCheckedChange={(checked) => setIsFree(checked)} /> Free (nothing needed to book)
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={payLater} disabled={isFree} onCheckedChange={setPayLater} /> Book now, pay later (at the desk)
            </label>
          </div>

          {preview ? (
            <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">
                {preview.total} class{preview.total === 1 ? "" : "es"} in the first 8 weeks
                {kind === "recurring" && !endDate ? ", then ongoing" : ""}
              </p>
              <p className="text-muted-foreground">
                {preview.dates.map((date) => `${prettyDate(date.date)} ${prettyTime(date.start)}`).join(" · ")}
                {preview.total > preview.dates.length ? " …" : ""}
              </p>
              {preview.clashes.length ? (
                <ul className="list-disc pl-5 text-amber-800 dark:text-amber-300">
                  {preview.clashes.map((clash, index) => (
                    <li key={index}>
                      {prettyDate(clash.date)}: {clash.reason === "room" ? "room" : "instructor"} already has {clash.with} ({clash.time})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-emerald-700 dark:text-emerald-300">No room or instructor clashes in the next 3 weeks.</p>
              )}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={check} disabled={busy}>
            Preview &amp; check
          </Button>
          <Button type="button" onClick={save} disabled={busy || !preview}>
            {busy ? "Saving…" : series ? "Save change" : "Schedule class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// End a SynqIQ series on a date.
export function EndSeriesDialog({ scheduleId, label, today }: { scheduleId: string; label: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "end", scheduleId, endDate });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2">
          End
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>End {label}</DialogTitle>
          <DialogDescription>
            The last class is on this date. Booked members on later dates stay listed so you can let them know.
          </DialogDescription>
        </DialogHeader>
        <Input type="date" min={today} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={busy || !endDate}>
            End series
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
