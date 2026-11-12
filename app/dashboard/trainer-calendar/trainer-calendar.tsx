"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, Clock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MemberSearch, type MemberSuggestion } from "../memberships/member-search";
import type { CalendarAppointment, CalendarBlock, CalendarSession } from "@/lib/trainer/sessions";
import { SESSION_STATUS_LABELS, canCloseSession, canEditAvailability, canReopenSession, withinAvailability } from "@/lib/trainer/rules";

export type SessionTypeOption = { id: number; name: string; minutes: number };
type Trainer = { id: string; name: string };
type Me = { id: string; role: string; isTrainer: boolean; isAdmin: boolean };

const START_HOUR = 5;
const END_HOUR = 22;
const PX_PER_MIN = 1;
const SNAP = 15;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

async function post(body: Record<string, unknown>) {
  try {
    const response = await fetch("/api/trainer-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json().catch(() => ({ success: false, error: "Something went wrong." }))) as {
      success: boolean;
      error?: string;
      needsReason?: boolean;
      coverage?: string | null;
      warnings?: string[];
      added?: number;
      skipped?: boolean;
    };
  } catch {
    return { success: false, error: "Couldn't reach SynqIQ. Check your connection." };
  }
}

const STATUS_STYLE: Record<string, string> = {
  booked: "border-sky-500 bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100",
  completed: "border-emerald-600 bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100",
  no_show: "border-amber-600 bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  cancelled: "border-neutral-300 bg-neutral-50 text-neutral-500 line-through dark:bg-neutral-900",
  late_cancelled: "border-rose-400 bg-rose-50 text-rose-800 line-through dark:bg-rose-950 dark:text-rose-200",
};

export function TrainerCalendar(props: {
  timezone: string;
  view: "week" | "day";
  from: string;
  date: string;
  today: string;
  trainers: Trainer[];
  trainerId: string | null;
  sessionTypes: SessionTypeOption[];
  me: Me;
  syncedAt: string | null;
  sessions: CalendarSession[];
  appointments: CalendarAppointment[];
  blocks: CalendarBlock[];
}) {
  const { timezone: zone, view, trainers, trainerId, me } = props;
  const router = useRouter();
  const [booking, setBooking] = useState<{ trainerId: string; start: DateTime } | null>(null);
  const [openSession, setOpenSession] = useState<CalendarSession | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const trainerName = (id: string) => trainers.find((t) => t.id === id)?.name ?? "Trainer";

  const go = (next: { trainer?: string | null; date?: string; view?: string }) => {
    const params = new URLSearchParams();
    const t = next.trainer === undefined ? trainerId : next.trainer;
    if (t) params.set("trainer", t);
    params.set("date", next.date ?? props.date);
    params.set("view", next.view ?? view);
    router.push(`/dashboard/trainer-calendar?${params.toString()}`);
  };
  const step = (dir: 1 | -1) =>
    go({
      date: DateTime.fromISO(props.date)
        .plus({ days: dir * (view === "week" ? 7 : 1) })
        .toISODate()!,
    });

  // Hours from Mindbody refresh at most every few hours when someone opens the page.
  useEffect(() => {
    const stale = !props.syncedAt || Date.now() - Date.parse(props.syncedAt) > 3 * 3_600_000;
    if (!stale) return;
    void post({ action: "refresh" }).then((result) => {
      if (result.success && !result.skipped) router.refresh();
    });
  }, [props.syncedAt, router]);

  const columns = useMemo(() => {
    if (view === "week") {
      return Array.from({ length: 7 }, (_, i) => {
        const day = DateTime.fromISO(props.from, { zone }).plus({ days: i });
        return {
          key: day.toISODate()!,
          label: day.toFormat("ccc d"),
          today: day.toISODate() === props.today,
          trainerId: trainerId ?? "",
          day,
        };
      });
    }
    const day = DateTime.fromISO(props.date, { zone });
    return trainers
      .filter(
        (t) =>
          props.blocks.some((b) => b.trainerId === t.id) ||
          props.sessions.some((s) => s.trainerId === t.id) ||
          props.appointments.some((a) => a.trainerId === t.id),
      )
      .map((t) => ({ key: t.id, label: t.name, today: false, trainerId: t.id, day }));
  }, [view, props.from, props.date, props.today, props.blocks, props.sessions, props.appointments, trainers, trainerId, zone]);

  const top = (iso: string, day: DateTime) => {
    const t = DateTime.fromISO(iso, { zone });
    const minutes = t.diff(day.startOf("day").set({ hour: START_HOUR }), "minutes").minutes;
    return Math.max(0, minutes) * PX_PER_MIN;
  };
  const height = (startIso: string, endIso: string, day: DateTime) =>
    Math.max(14, top(endIso, day) - top(startIso, day) || (Date.parse(endIso) - Date.parse(startIso)) / 60_000) * 1;
  const inColumn = (startIso: string, col: { day: DateTime; trainerId: string }, trainer: string) =>
    trainer === col.trainerId && DateTime.fromISO(startIso, { zone }).toISODate() === col.day.toISODate();
  const gridHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
  const title =
    view === "week"
      ? `${DateTime.fromISO(props.from).toFormat("LLL d")} – ${DateTime.fromISO(props.from).plus({ days: 6 }).toFormat("LLL d, yyyy")}`
      : DateTime.fromISO(props.date).toFormat("cccc, LLL d, yyyy");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          <Button size="sm" variant={view === "week" ? "default" : "ghost"} onClick={() => go({ view: "week" })}>
            One trainer
          </Button>
          <Button size="sm" variant={view === "day" ? "default" : "ghost"} onClick={() => go({ view: "day" })}>
            All trainers
          </Button>
        </div>
        {view === "week" ? (
          <select aria-label="Trainer" className={selectClass} value={trainerId ?? ""} onChange={(e) => go({ trainer: e.target.value })}>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Back" onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="outline" onClick={() => go({ date: props.today })}>
            Today
          </Button>
          <Button size="icon" variant="outline" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight />
          </Button>
          <Input
            type="date"
            aria-label="Go to date"
            className="h-9 w-40"
            value={props.date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
          />
        </div>
        <span className="font-medium">{title}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {trainerId && view === "week" && canEditAvailability(me, trainerId) ? (
            <Button size="sm" variant="outline" onClick={() => setHoursOpen(true)}>
              <Clock /> Hours
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await post({ action: "refresh" });
              setRefreshing(false);
              router.refresh();
            }}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} /> Hours from Mindbody
            {props.syncedAt ? (
              <span className="text-xs text-muted-foreground">
                {DateTime.fromISO(props.syncedAt).setZone(zone).toFormat("LLL d, h:mm a")}
              </span>
            ) : null}
          </Button>
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900" />{" "}
          Available
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-sky-100 ring-1 ring-sky-500" /> Booked in SynqIQ
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-600" /> Completed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-neutral-200 ring-1 ring-neutral-400" /> In Mindbody
        </span>
        <span>Tap an open time to book.</span>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">No trainer has hours or sessions on this day.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <div className="flex min-w-max">
            <div className="sticky left-0 z-10 w-14 shrink-0 border-r bg-card">
              <div className="h-10 border-b" />
              <div className="relative" style={{ height: gridHeight }}>
                {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                  <span
                    key={i}
                    className="absolute right-1 -translate-y-1/2 text-[11px] text-muted-foreground"
                    style={{ top: i * 60 * PX_PER_MIN }}
                  >
                    {i === 0 ? "" : DateTime.fromObject({ hour: START_HOUR + i }).toFormat("h a")}
                  </span>
                ))}
              </div>
            </div>
            {columns.map((col) => {
              const blocks = props.blocks.filter((b) => inColumn(b.startsAt, col, b.trainerId));
              const sessions = props.sessions.filter((s) => inColumn(s.startsAt, col, s.trainerId));
              const appts = props.appointments.filter((a) => inColumn(a.startsAt, col, a.trainerId));
              return (
                <div
                  key={col.key}
                  className={`border-r last:border-r-0 ${view === "week" ? "w-[150px] lg:w-[calc((100vw-22rem)/7)] lg:min-w-[130px]" : "w-[150px]"}`}
                >
                  <div
                    className={`flex h-10 items-center justify-center border-b px-1 text-center text-sm ${col.today ? "font-semibold text-primary" : "font-medium"}`}
                  >
                    <span className="truncate">{col.label}</span>
                  </div>
                  <div
                    className="relative cursor-pointer"
                    style={{ height: gridHeight }}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minutes = Math.floor((e.clientY - rect.top) / PX_PER_MIN / SNAP) * SNAP;
                      setBooking({ trainerId: col.trainerId, start: col.day.startOf("day").set({ hour: START_HOUR }).plus({ minutes }) });
                    }}
                  >
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                      <div
                        key={i}
                        className="absolute inset-x-0 border-t border-dashed border-border/60"
                        style={{ top: i * 60 * PX_PER_MIN }}
                      />
                    ))}
                    {blocks.map((b) => (
                      <div
                        key={b.id}
                        className="absolute inset-x-0 bg-emerald-50 dark:bg-emerald-950/40"
                        style={{ top: top(b.startsAt, col.day), height: height(b.startsAt, b.endsAt, col.day) }}
                      />
                    ))}
                    {appts.map((a) => (
                      <div
                        key={a.id}
                        onClick={(e) => e.stopPropagation()}
                        title={`${a.clientName} · ${a.sessionType} (Mindbody, ${a.status})`}
                        className="absolute inset-x-1 cursor-default overflow-hidden rounded-md border border-neutral-400 bg-neutral-200 px-1 text-[11px] leading-tight text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                        style={{ top: top(a.startsAt, col.day), height: height(a.startsAt, a.endsAt, col.day) }}
                      >
                        <span className="font-medium">{a.clientName}</span> · {a.sessionType}
                      </div>
                    ))}
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenSession(s);
                        }}
                        className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-1 text-left text-[11px] leading-tight shadow-sm ${STATUS_STYLE[s.status] ?? STATUS_STYLE.booked}`}
                        style={{ top: top(s.startsAt, col.day), height: height(s.startsAt, s.endsAt, col.day) }}
                      >
                        <span className="font-semibold">{s.clientName}</span>
                        <br />
                        {DateTime.fromISO(s.startsAt).setZone(zone).toFormat("h:mm")} · {s.sessionType}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {booking ? (
        <BookDialog
          key={`${booking.trainerId}|${booking.start.toISO()}`}
          zone={zone}
          trainerName={trainerName(booking.trainerId)}
          trainerId={booking.trainerId}
          start={booking.start}
          sessionTypes={props.sessionTypes}
          available={(minutes) =>
            withinAvailability(
              { startsAt: booking.start.toUTC().toISO()!, endsAt: booking.start.plus({ minutes }).toUTC().toISO()! },
              null,
              props.blocks
                .filter((b) => b.trainerId === booking.trainerId)
                .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt, sessionTypeIds: null })),
            )
          }
          onClose={(saved) => {
            setBooking(null);
            if (saved) router.refresh();
          }}
        />
      ) : null}
      {openSession ? (
        <SessionDialog
          session={openSession}
          zone={zone}
          trainerName={trainerName(openSession.trainerId)}
          me={me}
          onClose={(changed) => {
            setOpenSession(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
      {hoursOpen && trainerId ? (
        <HoursDialog
          zone={zone}
          trainerId={trainerId}
          trainerName={trainerName(trainerId)}
          date={props.date}
          blocks={props.blocks.filter((b) => b.trainerId === trainerId && b.source === "synqiq")}
          onClose={(changed) => {
            setHoursOpen(false);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function BookDialog({
  zone,
  trainerId,
  trainerName,
  start,
  sessionTypes,
  available,
  onClose,
}: {
  zone: string;
  trainerId: string;
  trainerName: string;
  start: DateTime;
  sessionTypes: SessionTypeOption[];
  available: (minutes: number) => boolean;
  onClose: (saved: boolean) => void;
}) {
  const defaultType = sessionTypes.find((t) => t.id === 10) ?? sessionTypes[0];
  const [typeId, setTypeId] = useState<number>(defaultType?.id ?? 0);
  const [minutes, setMinutes] = useState<number>(defaultType?.minutes ?? 50);
  const [time, setTime] = useState(start.toFormat("HH:mm"));
  const [client, setClient] = useState<MemberSuggestion | null>(null);
  const [note, setNote] = useState("");
  const [needsReason, setNeedsReason] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startAt = DateTime.fromISO(`${start.toISODate()}T${time}`, { zone });
  const open = startAt.isValid && available(minutes);

  async function save() {
    if (!client) return setError("Pick a client.");
    setSaving(true);
    setError(null);
    const result = await post({
      action: "book",
      trainerId,
      clientId: client.id,
      sessionTypeId: typeId,
      minutes,
      startsAt: startAt.toISO(),
      note,
    });
    setSaving(false);
    if (!result.success) {
      setNeedsReason(Boolean(result.needsReason));
      return setError(result.error ?? "Couldn't book.");
    }
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(value) => !value && onClose(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Book {trainerName}</DialogTitle>
          <DialogDescription>{start.toFormat("cccc, LLL d")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">Start</span>
              <Input type="time" step={300} className="h-9 w-32" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="flex-1 space-y-1 text-sm">
              <span className="block text-muted-foreground">Session</span>
              <select
                className={`${selectClass} w-full`}
                value={typeId}
                onChange={(e) => {
                  const type = sessionTypes.find((t) => t.id === Number(e.target.value));
                  setTypeId(Number(e.target.value));
                  if (type) setMinutes(type.minutes);
                }}
              >
                {sessionTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">Minutes</span>
              <Input
                type="number"
                min={10}
                max={240}
                step={5}
                className="h-9 w-20"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          </div>
          <p className={`text-xs ${open ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
            {startAt.isValid
              ? `${startAt.toFormat("h:mm a")} – ${startAt.plus({ minutes }).toFormat("h:mm a")}: ${open ? "inside available hours" : "outside available hours (only the trainer or a Club Admin can book this, with a reason)"}`
              : "Pick a start time."}
          </p>
          {client ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{client.name}</span> <span className="text-muted-foreground">{client.status}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setClient(null)}>
                Change
              </Button>
            </div>
          ) : (
            <MemberSearch
              initialQuery=""
              endpoint="/api/check-in/search"
              onPick={setClient}
              placeholder="Client: name, email or phone"
              autoFocus
            />
          )}
          <label className="block space-y-1 text-sm">
            <span className="block text-muted-foreground">{needsReason ? "Reason (required)" : "Note (optional)"}</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={needsReason ? "Why book it anyway?" : ""} />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onClose(false)}>
              Close
            </Button>
            <Button onClick={save} disabled={saving || !client}>
              {saving ? <Loader2 className="animate-spin" /> : null} Book session
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SessionDialog({
  session,
  zone,
  trainerName,
  me,
  onClose,
}: {
  session: CalendarSession;
  zone: string;
  trainerName: string;
  me: Me;
  onClose: (changed: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const started = Date.now() >= Date.parse(session.startsAt);
  const mayClose = canCloseSession(me, session.trainerId);
  const start = DateTime.fromISO(session.startsAt).setZone(zone);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await post({ id: session.id, reason, ...body });
    setBusy(false);
    if (!result.success) return setError(result.error ?? "Couldn't save.");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(value) => !value && onClose(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{session.clientName}</DialogTitle>
          <DialogDescription>
            {session.sessionType} with {trainerName} · {start.toFormat("ccc, LLL d, h:mm a")} –{" "}
            {DateTime.fromISO(session.endsAt).setZone(zone).toFormat("h:mm a")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-medium">{SESSION_STATUS_LABELS[session.status] ?? session.status}</span>
            {session.coverageName ? (
              <span className="text-muted-foreground"> · uses {session.coverageName}</span>
            ) : (
              <span className="text-muted-foreground"> · no pack on file</span>
            )}
          </p>
          {session.note ? <p className="text-muted-foreground">Note: {session.note}</p> : null}
          {session.cancelReason ? <p className="text-muted-foreground">Reason: {session.cancelReason}</p> : null}
          {session.pay && !session.pay.voided ? (
            <p className="rounded-md bg-muted px-3 py-2">
              Trainer pay recorded for {start.toFormat("LLL d")}: <span className="font-medium">{money(session.pay.amountCents)}</span>
              {session.pay.valueCents != null ? ` (session value ${money(session.pay.valueCents)}` : " (session value unknown"}
              {session.pay.rateName ? `, ${session.pay.rateName})` : ", no session rate set)"}. Practice until payroll moves off Mindbody.
            </p>
          ) : null}
          {session.status === "booked" && mayClose ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !started} onClick={() => act({ action: "close", actionType: "complete" })}>
                  Complete
                </Button>
                <Button variant="outline" disabled={busy || !started} onClick={() => act({ action: "close", actionType: "no_show" })}>
                  No-show
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act({ action: "close", actionType: "cancel" })}>
                  Cancel
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act({ action: "close", actionType: "late_cancel" })}>
                  Late cancel
                </Button>
              </div>
              {!started ? <p className="text-xs text-muted-foreground">Complete and No-show unlock when the session starts.</p> : null}
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (for a cancel)" />
            </div>
          ) : null}
          {session.status === "booked" && !mayClose ? (
            <p className="text-muted-foreground">The trainer, a Sales Lead or a Club Admin closes out this session.</p>
          ) : null}
          {session.status !== "booked" && canReopenSession(me) ? (
            <div className="space-y-2 border-t pt-3">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why reopen it?" />
              <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => act({ action: "reopen" })}>
                Reopen (removes its pay)
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HoursDialog({
  zone,
  trainerId,
  trainerName,
  date,
  blocks,
  onClose,
}: {
  zone: string;
  trainerId: string;
  trainerName: string;
  date: string;
  blocks: CalendarBlock[];
  onClose: (changed: boolean) => void;
}) {
  const [day, setDay] = useState(date);
  const [start, setStart] = useState("06:00");
  const [end, setEnd] = useState("12:00");
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  return (
    <Dialog open onOpenChange={(value) => !value && onClose(changed)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{trainerName}&apos;s hours</DialogTitle>
          <DialogDescription>
            Hours from Mindbody are copied automatically (change those in Mindbody until the switch). Add extra hours here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-muted-foreground">Day</span>
              <Input type="date" className="h-9 w-40" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="block text-muted-foreground">From</span>
              <Input type="time" step={900} className="h-9 w-28" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="block text-muted-foreground">To</span>
              <Input type="time" step={900} className="h-9 w-28" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="block text-muted-foreground">Repeat weekly</span>
              <select className={selectClass} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                {[1, 2, 4, 8, 12, 26].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Just this day" : `${n} weeks`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await post({ action: "availabilityAdd", trainerId, date: day, start, end, weeks });
              setBusy(false);
              if (!result.success) return setMessage({ ok: false, text: result.error ?? "Couldn't save." });
              setChanged(true);
              setMessage({ ok: true, text: `Added ${result.added} time${result.added === 1 ? "" : "s"}.` });
            }}
          >
            Add hours
          </Button>
          {message ? <p className={message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{message.text}</p> : null}
          {blocks.length ? (
            <div className="space-y-1 border-t pt-3">
              <p className="font-medium">Added in SynqIQ (this week)</p>
              {blocks
                .filter((b) => !removed.has(b.id))
                .map((b) => (
                  <div key={b.id} className="flex items-center justify-between">
                    <span>
                      {DateTime.fromISO(b.startsAt).setZone(zone).toFormat("ccc LLL d, h:mm a")} –{" "}
                      {DateTime.fromISO(b.endsAt).setZone(zone).toFormat("h:mm a")}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const result = await post({ action: "availabilityDelete", id: b.id });
                        if (result.success) {
                          setRemoved(new Set([...removed, b.id]));
                          setChanged(true);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
