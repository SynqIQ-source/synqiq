"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { PublicClass, PublicSchedule } from "@/lib/widget/schedule";
import { ClassAction, type MyBooking } from "./member-ui";

// The member app's Book screen: program tabs (classes / pool lanes), a week
// strip of days, the day's classes, and a class sheet with Book / Join
// waitlist / Cancel (spot picking included). Same booking rules and APIs as
// before; only the look and flow are new.

const minutesBetween = (start: string, end: string) => {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
    if (!match) return null;
    const hours = (Number(match[1]) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
    return hours * 60 + Number(match[2]);
  };
  const a = parse(start);
  const b = parse(end);
  return a !== null && b !== null && b > a ? b - a : null;
};

const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const dayDate = (date: string) => new Date(`${date}T12:00:00`);

export function BookScreen({
  schedule,
  studio,
  signedIn,
  bookings,
  initialClassId,
  today,
}: {
  schedule: PublicSchedule;
  studio: number;
  signedIn: boolean;
  bookings: Record<string, MyBooking>;
  initialClassId?: string;
  today: string;
}) {
  const color = schedule.studio.primaryColor;
  const classes = useMemo(() => schedule.classes.filter((item) => !item.cancelled || bookings[item.id]), [schedule.classes, bookings]);
  const hasPool = classes.some((item) => item.isPool);
  const picked = initialClassId ? classes.find((item) => item.id === initialClassId) : undefined;
  const [pool, setPool] = useState(Boolean(picked?.isPool));
  const [day, setDay] = useState(picked?.date ?? schedule.days.find((date) => date >= today) ?? schedule.days[0]);
  const [open, setOpen] = useState<PublicClass | null>(picked ?? null);
  const [monthOpen, setMonthOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    strip.current?.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [day]);

  const shown = classes.filter((item) => item.date === day && item.isPool === pool);
  const busyDays = new Set(classes.filter((item) => item.isPool === pool).map((item) => item.date));

  return (
    <div>
      {hasPool ? (
        <div
          className="flex gap-6 px-4 pb-2 text-base font-medium text-white/70"
          style={{ background: color, boxShadow: `0 0 0 100vmax ${color}`, clipPath: "inset(0 -100vmax)" }}
        >
          {[
            { label: "Group Classes", value: false },
            { label: "Pool Lanes", value: true },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setPool(option.value)}
              className={pool === option.value ? "border-b-2 border-white pb-1 text-white" : "pb-1"}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="sticky top-14 z-20 border-b bg-white">
        <div className="flex items-center">
          <div ref={strip} className="flex flex-1 gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none]">
            {schedule.days.map((date) => {
              const d = dayDate(date);
              const selected = date === day;
              return (
                <button
                  key={date}
                  data-day={date}
                  type="button"
                  onClick={() => setDay(date)}
                  className="flex shrink-0 flex-col items-center gap-1"
                >
                  <span
                    className={`flex size-11 items-center justify-center rounded-full border text-base font-medium ${
                      selected
                        ? "border-transparent text-white"
                        : busyDays.has(date)
                          ? "border-neutral-400"
                          : "border-neutral-200 text-neutral-400"
                    }`}
                    style={selected ? { background: "#262626" } : undefined}
                  >
                    {d.getDate()}
                  </span>
                  <span className={`text-[11px] ${selected ? "font-semibold" : "text-neutral-500"}`}>
                    {date === today ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" aria-label="Pick a date" onClick={() => setMonthOpen((value) => !value)} className="px-3 text-neutral-600">
            <CalendarDays className="size-5" />
          </button>
        </div>
        {monthOpen ? (
          <div className="grid grid-cols-7 gap-1 border-t px-3 py-3 text-center text-sm">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
              <span key={index} className="text-xs text-neutral-500">
                {label}
              </span>
            ))}
            {Array.from({ length: dayDate(schedule.days[0]).getDay() }).map((_, index) => (
              <span key={`pad-${index}`} />
            ))}
            {schedule.days.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => {
                  setDay(date);
                  setMonthOpen(false);
                }}
                className={`mx-auto flex size-9 items-center justify-center rounded-full ${date === day ? "text-white" : busyDays.has(date) ? "" : "text-neutral-400"}`}
                style={date === day ? { background: "#262626" } : undefined}
              >
                {dayDate(date).getDate()}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="bg-white">
        <h2 className="px-4 pt-4 pb-1 text-lg font-semibold">
          {dayDate(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </h2>
        {shown.length === 0 ? (
          <p className="px-4 pb-8 pt-2 text-neutral-500">Nothing scheduled{pool ? " in the pool" : ""} this day.</p>
        ) : (
          <ul className="divide-y px-4">
            {shown.map((item) => {
              const booking = bookings[item.id];
              const length = minutesBetween(item.start, item.end);
              const past = Date.parse(item.startsAt) < Date.now();
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(item)}
                    className={`flex w-full gap-3 py-3 text-left ${past ? "opacity-50" : ""}`}
                  >
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-600">
                      {initials(item.instructor) || "·"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{item.name}</span>
                      <span className="block text-sm text-neutral-700">
                        {item.start}
                        {length ? ` • ${length} min` : ""}
                      </span>
                      {item.instructor ? <span className="block text-sm text-neutral-500">{item.instructor}</span> : null}
                      {item.cancelled ? (
                        <span className="block text-sm font-medium text-red-700">Cancelled</span>
                      ) : booking ? (
                        <span
                          className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ background: color }}
                        >
                          {booking.status === "waitlisted" ? "On the waitlist" : booking.status === "checked_in" ? "Checked in" : "Booked"}
                          {booking.spotLabel && booking.status !== "waitlisted" ? ` · ${booking.spotLabel}` : ""}
                        </span>
                      ) : item.spotsLeft === 0 ? (
                        <span className="block text-sm">Class is full. Waitlist only</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open ? (
        <ClassSheet
          item={open}
          schedule={schedule}
          studio={studio}
          signedIn={signedIn}
          booking={bookings[open.id]}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function ClassSheet({
  item,
  schedule,
  studio,
  signedIn,
  booking,
  onClose,
}: {
  item: PublicClass;
  schedule: PublicSchedule;
  studio: number;
  signedIn: boolean;
  booking: MyBooking | undefined;
  onClose: () => void;
}) {
  const color = schedule.studio.primaryColor;
  const type = item.typeId ? schedule.types[item.typeId] : undefined;
  const length = minutesBetween(item.start, item.end);
  const [more, setMore] = useState(false);
  const [booked, setBooked] = useState<{ status: string; spot: string | null } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={item.name}
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center pt-2">
          <span className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-3">
          <div>
            <h3 className="text-2xl font-semibold">{item.name}</h3>
            <p className="text-neutral-700">
              {dayDate(item.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} • {item.start}
              {length ? ` (${length}m)` : ""}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100">
            <X className="size-5" />
          </button>
        </div>

        {booked ? (
          <div className="px-5 py-8 text-center">
            <p className="text-4xl">🙌</p>
            <p className="mt-2 text-xl font-semibold">{booked.status === "waitlisted" ? "You're on the waitlist" : "You're booked!"}</p>
            {booked.spot ? <p className="text-neutral-600">{booked.spot}</p> : null}
            <button
              type="button"
              onClick={onClose}
              className="mt-6 h-12 w-full rounded-xl text-base font-medium text-white"
              style={{ background: color }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 border-t px-5 py-4">
              <h4 className="mb-2 font-semibold">About this class</h4>
              {item.instructor ? (
                <p className="mb-2 flex items-center gap-2">
                  <span
                    className="flex size-7 items-center justify-center rounded-full text-[11px] font-medium text-white"
                    style={{ background: color }}
                  >
                    {initials(item.instructor)}
                  </span>
                  {item.instructor}
                </p>
              ) : null}
              {item.room ? <p className="text-sm text-neutral-600">{item.room}</p> : null}
              {type?.description ? (
                <p className={`mt-2 text-sm text-neutral-700 ${more ? "" : "line-clamp-3"}`}>{type.description}</p>
              ) : null}
              {type?.description && type.description.length > 140 ? (
                <button type="button" onClick={() => setMore((value) => !value)} className="mt-1 text-sm font-semibold underline">
                  {more ? "Show less" : "Read more"}
                </button>
              ) : null}
              {item.capacity !== null && item.spotsLeft !== null && !item.cancelled ? (
                <p className="mt-3 text-sm text-neutral-600">
                  {item.spotsLeft === 0 ? "Class is full. Waitlist only." : `${item.spotsLeft} of ${item.capacity} spots left`}
                </p>
              ) : null}
            </div>
            <div className="border-t bg-neutral-50 px-5 py-4">
              {item.cancelled ? (
                <p className="text-center font-medium text-red-700">This class is cancelled.</p>
              ) : (
                <ClassAction
                  item={item}
                  lateMinutes={type?.lateCancelMinutes ?? null}
                  studio={studio}
                  signedIn={signedIn}
                  booking={booking}
                  color={color}
                  full
                  onBooked={(status, spot) => setBooked({ status, spot })}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
