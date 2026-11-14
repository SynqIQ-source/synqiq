"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

// Instructor / class style / year / sort. Instructors are locked to themselves.
export function RatingsFilters(props: {
  isAdmin: boolean;
  instructors: { id: string; name: string }[];
  instructor: string | null;
  styles: string[];
  style: string | null;
  year: number;
  years: number[];
  sort: string;
}) {
  const router = useRouter();
  const go = (change: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const next = {
      instructor: props.isAdmin ? props.instructor : null,
      style: props.style,
      year: String(props.year),
      sort: props.sort,
      ...change,
    };
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    router.push(`/dashboard/ratings?${params.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.isAdmin ? (
        <select
          aria-label="Instructor"
          className={selectClass}
          value={props.instructor ?? ""}
          onChange={(e) => go({ instructor: e.target.value || null })}
        >
          <option value="">All instructors</option>
          {props.instructors.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      ) : null}
      <select
        aria-label="Class style"
        className={selectClass}
        value={props.style ?? ""}
        onChange={(e) => go({ style: e.target.value || null })}
      >
        <option value="">All class styles</option>
        {props.styles.map((style) => (
          <option key={style} value={style}>
            {style}
          </option>
        ))}
      </select>
      <select aria-label="Year" className={selectClass} value={props.year} onChange={(e) => go({ year: e.target.value })}>
        {props.years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <select aria-label="Sort" className={selectClass} value={props.sort} onChange={(e) => go({ sort: e.target.value })}>
        <option value="newest">Newest first</option>
        <option value="lowest">Lowest stars first</option>
        <option value="highest">Highest stars first</option>
      </select>
    </div>
  );
}

// Club Admin: who gets the rating emails.
export function RatingsMode({ mode }: { mode: string }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
        <span className="font-medium">Rating emails go to</span>
        <select
          aria-label="Who gets rating emails"
          className={selectClass}
          value={value}
          disabled={saving}
          onChange={async (e) => {
            const next = e.target.value;
            setSaving(true);
            setError(null);
            const response = await fetch("/api/ratings/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mode: next }),
            });
            setSaving(false);
            if (response.ok) {
              setValue(next);
              router.refresh();
            } else setError("Couldn't save. Try again.");
          }}
        >
          <option value="testers">Testers only (member booking testers)</option>
          <option value="everyone">Every member</option>
          <option value="off">Nobody (off)</option>
        </select>
        <span className="text-muted-foreground">
          The first class with each instructor each quarter; at most 2 emails a week per member; sent each morning.
        </span>
        {error ? <span className="text-destructive">{error}</span> : null}
      </CardContent>
    </Card>
  );
}
