"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicClass, PublicSchedule } from "@/lib/widget/schedule";
import { ScheduleWidget } from "@/app/widget/schedule/schedule-widget";
import { RoomMap } from "@/components/room-map";
import type { RoomLayout } from "@/lib/rooms/layout";

// Member booking pages (first-party on synqiq.co): sign in, set a password
// from the emailed link, book / cancel. Plain styling in the studio's color.

type Result = {
  success?: boolean;
  error?: string;
  message?: string;
  status?: string;
  feeCents?: number | null;
  signIn?: boolean;
  spot?: string | null;
  spotTaken?: boolean;
};

async function post(url: string, body: Record<string, unknown>): Promise<Result> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as Result;
    return response.ok ? result : { ...result, success: false, error: result.error ?? "Something went wrong. Try again." };
  } catch {
    return { success: false, error: "Couldn't reach the studio. Check your connection." };
  }
}

const inputClass = "h-11 w-full rounded-md border border-neutral-300 px-3 text-base outline-none focus:border-neutral-500";

function PrimaryButton({ color, disabled, children }: { color: string; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="h-11 w-full rounded-md text-base font-medium text-white disabled:opacity-60"
      style={{ background: color }}
    >
      {children}
    </button>
  );
}

export function SignInForm({ studio, color, next, classId }: { studio: number; color: string; next: string; classId?: string }) {
  const keep = classId ? `&class=${classId}` : "";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post("/api/member/sign-in", { studio, email, password });
    setBusy(false);
    if (!result.success) return setError(result.error ?? "Couldn't sign in.");
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        Email
        <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          className={inputClass}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <PrimaryButton color={color} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </PrimaryButton>
      <div className="flex justify-between text-sm">
        <Link href={`/m/${studio}/get-link?new=1${keep}`} className="underline underline-offset-4">
          First time? Create your password
        </Link>
        <Link href={`/m/${studio}/get-link?${keep.slice(1)}`} className="underline underline-offset-4">
          Forgot password
        </Link>
      </div>
    </form>
  );
}

export function RequestLinkForm({ studio, color, classId }: { studio: number; color: string; classId?: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await post("/api/member/request-link", { studio, email, classId });
    setBusy(false);
    setMessage(
      result.success ? { ok: true, text: result.message ?? "Check your email." } : { ok: false, text: result.error ?? "Try again." },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        The email the studio has for you
        <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
      <PrimaryButton color={color} disabled={busy}>
        {busy ? "Sending…" : "Email me a link"}
      </PrimaryButton>
      <p className="text-sm">
        <Link href={`/m/${studio}/sign-in${classId ? `?class=${classId}` : ""}`} className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function SetPasswordForm({ studio, color, token, classId }: { studio: number; color: string; token: string; classId?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const result = await post("/api/member/set-password", { token, password });
    setBusy(false);
    if (!result.success) return setError(result.error ?? "Couldn't save.");
    router.replace(`/m/${studio}${classId ? `?class=${classId}` : ""}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        New password (at least 10 characters)
        <input
          className={inputClass}
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium">
        Same password again
        <input
          className={inputClass}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <PrimaryButton color={color} disabled={busy}>
        {busy ? "Saving…" : "Save and sign in"}
      </PrimaryButton>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="underline underline-offset-4"
      onClick={async () => {
        await post("/api/member/sign-out", {});
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

export type MyBooking = { id: string; status: "booked" | "waitlisted" | "checked_in"; spotLabel?: string | null };

// The schedule with Book / Join waitlist / Cancel buttons.
export function MemberSchedule({
  schedule,
  studio,
  signedIn,
  bookings,
  initialClassId,
  header,
}: {
  schedule: PublicSchedule;
  studio: number;
  signedIn: boolean;
  bookings: Record<string, MyBooking>;
  initialClassId?: string;
  header: ReactNode;
}) {
  const color = schedule.studio.primaryColor;
  const picked = initialClassId ? schedule.classes.find((item) => item.id === initialClassId) : undefined;
  const lateMinutes = (item: PublicClass) => (item.typeId ? (schedule.types[item.typeId]?.lateCancelMinutes ?? null) : null);
  const pickedCard = picked ? (
    <div className="mb-3 rounded-lg border-2 px-3 py-3" style={{ borderColor: color }}>
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Your class</p>
      <p className="text-base font-semibold">{picked.name}</p>
      <p className="mb-2 text-sm text-neutral-600">
        {new Date(`${picked.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} ·{" "}
        {picked.start}
        {picked.instructor ? ` · ${picked.instructor}` : ""}
      </p>
      <ClassAction
        item={picked}
        lateMinutes={lateMinutes(picked)}
        studio={studio}
        signedIn={signedIn}
        booking={bookings[picked.id]}
        color={color}
      />
    </div>
  ) : null;
  return (
    <ScheduleWidget
      schedule={schedule}
      initialClassId={initialClassId}
      header={
        <>
          {header}
          {pickedCard}
        </>
      }
      footer={null}
      renderAction={(item) => (
        <ClassAction
          key={item.id}
          lateMinutes={item.typeId ? (schedule.types[item.typeId]?.lateCancelMinutes ?? null) : null}
          item={item}
          studio={studio}
          signedIn={signedIn}
          booking={bookings[item.id]}
          color={color}
        />
      )}
    />
  );
}

function ClassAction({
  item,
  studio,
  signedIn,
  booking,
  color,
  lateMinutes,
}: {
  item: PublicClass;
  lateMinutes: number | null;
  studio: number;
  signedIn: boolean;
  booking: MyBooking | undefined;
  color: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const started = Date.parse(item.startsAt) <= Date.now();

  if (!signedIn) {
    return (
      <Link
        href={`/m/${studio}/sign-in?class=${item.id}`}
        className="inline-block rounded-md px-3 py-1.5 text-sm font-medium text-white"
        style={{ background: color }}
      >
        Sign in to book
      </Link>
    );
  }

  async function book(spotId?: string) {
    setBusy(true);
    setMessage(null);
    const result = await post("/api/member/bookings", { studio, sessionId: item.id, spotId });
    setBusy(false);
    if (!result.success) {
      if (result.spotTaken) setPicking(true);
      return setMessage({ ok: false, text: result.error ?? "Couldn't book." });
    }
    setPicking(false);
    setMessage({
      ok: true,
      text:
        result.status === "waitlisted"
          ? "You're on the waitlist."
          : `You're booked${result.spot ? ` on ${result.spot}` : ""}. See you there!`,
    });
    router.refresh();
  }

  async function cancel() {
    if (!booking) return;
    setBusy(true);
    setMessage(null);
    const result = await post(`/api/member/bookings/${booking.id}`, { studio });
    setBusy(false);
    setConfirming(false);
    if (!result.success) return setMessage({ ok: false, text: result.error ?? "Couldn't cancel." });
    setMessage({
      ok: true,
      text:
        result.status === "late_cancelled"
          ? `Cancelled as a late cancel${result.feeCents ? ` ($${(result.feeCents / 100).toFixed(0)} fee)` : ""}.`
          : booking.status === "waitlisted"
            ? "You left the waitlist."
            : "Cancelled.",
    });
    router.refresh();
  }

  const late = lateMinutes !== null && Date.parse(item.startsAt) - Date.now() < lateMinutes * 60_000;
  return (
    <div className="space-y-2">
      {booking ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: color }}>
            {booking.status === "waitlisted" ? "On the waitlist" : booking.status === "checked_in" ? "Checked in" : "You're booked"}
            {booking.spotLabel && booking.status !== "waitlisted" ? ` · ${booking.spotLabel}` : ""}
          </span>
          {booking.status !== "checked_in" && !started ? (
            confirming ? (
              <>
                <span className="text-xs text-neutral-600">
                  {late && booking.status === "booked" ? "This counts as a late cancel. Cancel anyway?" : "Cancel this?"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancel}
                  className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700"
                >
                  {busy ? "Cancelling…" : "Yes, cancel"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 text-sm underline">
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="rounded-md border px-3 py-1 text-sm">
                {booking.status === "waitlisted" ? "Leave waitlist" : "Cancel"}
              </button>
            )
          ) : null}
        </div>
      ) : !started ? (
        picking ? (
          <SpotPicker
            studio={studio}
            sessionId={item.id}
            color={color}
            busy={busy}
            onPick={(spotId) => book(spotId)}
            onCancel={() => setPicking(false)}
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => (item.pickSpot && item.spotsLeft !== 0 ? setPicking(true) : book())}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: color }}
          >
            {busy
              ? "Booking…"
              : item.spotsLeft === 0
                ? "Join waitlist"
                : item.pickSpot
                  ? `Book · pick your ${item.pickSpot.toLowerCase()}`
                  : "Book"}
          </button>
        )
      ) : null}
      {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </div>
  );
}

// Pick-a-spot: the room with taken spots greyed out; tap a free one, then
// confirm. Taken spots never say who has them.
function SpotPicker({
  studio,
  sessionId,
  color,
  busy,
  onPick,
  onCancel,
}: {
  studio: number;
  sessionId: string;
  color: string;
  busy: boolean;
  onPick: (spotId: string) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<{ layout: RoomLayout; taken: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/member/spots?studio=${studio}&sessionId=${sessionId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { success?: boolean; error?: string; layout?: RoomLayout | null; taken?: string[] }) => {
        if (!live) return;
        if (!result.success || !result.layout) return setError(result.error ?? "Couldn't load the room. Try again.");
        setData({ layout: result.layout, taken: new Set(result.taken ?? []) });
      })
      .catch(() => live && setError("Couldn't load the room. Check your connection."));
    return () => {
      live = false;
    };
  }, [studio, sessionId]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-500">Loading the room…</p>;
  const spot = data.layout.items.find((item) => item.id === chosen);
  const noun = data.layout.spotNoun;
  return (
    <div className="space-y-2 rounded-lg border bg-white p-3">
      <p className="text-sm font-medium">Pick your {noun.toLowerCase()}</p>
      <p className="text-center text-[11px] tracking-wide text-neutral-500 uppercase">Front of the room</p>
      <RoomMap
        layout={data.layout}
        taken={data.taken}
        selected={chosen}
        color={color}
        onCell={(_x, _y, item) => {
          if (item?.kind === "spot" && !data.taken.has(item.id)) setChosen(item.id);
        }}
      />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={!spot || busy}
          onClick={() => spot && onPick(spot.id)}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: color }}
        >
          {busy ? "Booking…" : spot ? `Book ${noun} ${spot.label}` : `Tap a ${noun.toLowerCase()}`}
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1 text-sm underline">
          Not now
        </button>
      </div>
    </div>
  );
}
