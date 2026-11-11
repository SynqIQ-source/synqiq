"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicSchedule } from "@/lib/widget/schedule";

// The schedule widget: pick a day, filter by program or class, tap a class
// for its description. Tells the page embedding it how tall it is, so the
// iframe can grow to fit (see the embed snippet).
export function ScheduleWidget({ schedule }: { schedule: PublicSchedule }) {
  const { studio, days, classes, types } = schedule;
  const firstDay = days.find((day) => classes.some((item) => item.date === day && !item.isPool)) ?? days[0];
  const [day, setDay] = useState(firstDay);
  const [program, setProgram] = useState("all");
  const [classType, setClassType] = useState("all");
  const [showPool, setShowPool] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const color = studio.primaryColor;

  const programs = useMemo(
    () => [...new Set(classes.filter((item) => !item.isPool && item.program).map((item) => item.program as string))].sort(),
    [classes],
  );
  const classNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of classes)
      if (!item.isPool && item.typeId && (program === "all" || item.program === program)) seen.set(item.typeId, item.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [classes, program]);
  const visible = classes.filter(
    (item) =>
      item.date === day &&
      (showPool || !item.isPool) &&
      (program === "all" || item.program === program) &&
      (classType === "all" || item.typeId === classType),
  );
  const poolCount = classes.filter((item) => item.date === day && item.isPool).length;

  // Report height to the embedding page.
  useEffect(() => {
    const element = rootRef.current;
    if (!element || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "synqiq-widget-height", height: element.scrollHeight + 16 }, "*");
    send();
    const observer = new ResizeObserver(send);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const label = (iso: string) => {
    const date = new Date(`${iso}T12:00:00`);
    return {
      weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
      day: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  };

  return (
    <div ref={rootRef} className="mx-auto max-w-3xl bg-white p-3 font-sans text-sm text-neutral-900 sm:p-4">
      <header className="mb-3 flex items-center gap-3">
        {studio.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- studio logo
          <img src={studio.logoUrl} alt="" className="h-8 w-auto" />
        ) : null}
        <h1 className="text-base font-semibold">{studio.name} class schedule</h1>
      </header>

      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Day">
        {days.map((iso) => {
          const { weekday, day: date } = label(iso);
          const selected = iso === day;
          return (
            <button
              key={iso}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setDay(iso);
                setOpenId(null);
              }}
              className="flex min-w-14 shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 text-xs"
              style={selected ? { background: color, borderColor: color, color: "white" } : undefined}
            >
              <span className="font-medium">{weekday}</span>
              <span>{date}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Program"
          value={program}
          onChange={(event) => {
            setProgram(event.target.value);
            setClassType("all");
          }}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="all">All programs</option>
          {programs.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Class"
          value={classType}
          onChange={(event) => setClassType(event.target.value)}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="all">All classes</option>
          {classNames.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {poolCount ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={showPool} onChange={(event) => setShowPool(event.target.checked)} /> Pool lanes
          </label>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-neutral-500">No classes for this day.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {visible.map((item) => {
            const type = item.typeId ? types[item.typeId] : undefined;
            const open = openId === item.id;
            const full = item.spotsLeft === 0;
            return (
              <li key={item.id} className={item.cancelled ? "opacity-60" : undefined}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : item.id)}
                  aria-expanded={open}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-neutral-50"
                >
                  <span className="w-20 shrink-0 tabular-nums">
                    <span className="block font-semibold">{item.start}</span>
                    <span className="text-xs text-neutral-500">{item.end}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block font-semibold ${item.cancelled ? "line-through" : ""}`}>{item.name}</span>
                    <span className="block text-xs text-neutral-600">{[item.instructor, item.room].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    {item.cancelled ? (
                      <span className="font-medium text-red-700">Cancelled</span>
                    ) : full ? (
                      <span className="font-medium text-amber-700">Full · waitlist</span>
                    ) : item.spotsLeft !== null ? (
                      <span className="font-medium" style={{ color }}>
                        {item.spotsLeft} spot{item.spotsLeft === 1 ? "" : "s"} left
                      </span>
                    ) : null}
                  </span>
                </button>
                {open ? (
                  <div className="space-y-2 bg-neutral-50 px-3 pt-1 pb-3 text-sm">
                    <div className="flex flex-wrap gap-1 text-xs">
                      {item.program ? <span className="rounded-full border px-2 py-0.5">{item.program}</span> : null}
                      {type?.level ? <span className="rounded-full border px-2 py-0.5">{type.level}</span> : null}
                      {item.capacity ? <span className="rounded-full border px-2 py-0.5">{item.capacity} spots</span> : null}
                    </div>
                    <p className="whitespace-pre-line text-neutral-700">{type?.description ?? "No description yet."}</p>
                    {type?.lateCancelMinutes ? (
                      <p className="text-xs text-neutral-500">
                        Cancel at least{" "}
                        {type.lateCancelMinutes >= 60 && type.lateCancelMinutes % 60 === 0
                          ? `${type.lateCancelMinutes / 60} hour${type.lateCancelMinutes === 60 ? "" : "s"}`
                          : `${type.lateCancelMinutes} minutes`}{" "}
                        before class to avoid a late cancel.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-center text-xs text-neutral-400">Book through the studio app or at the front desk.</p>
    </div>
  );
}
