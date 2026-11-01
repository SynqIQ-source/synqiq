"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

export type ItemRow = { name: string; counts: boolean; guessed: boolean; lastSeen: string };

// One list of Mindbody names with a tick each. Saves on click.
export function ItemList({ kind, rows, empty }: { kind: "contract" | "sale_item"; rows: ItemRow[]; empty: string }) {
  const [items, setItems] = useState(rows);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(
    () => items.filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [items, filter],
  );

  async function toggle(name: string, counts: boolean) {
    setError(null);
    setItems((current) => current.map((item) => (item.name === name ? { ...item, counts, guessed: false } : item)));
    const response = await fetch("/api/settings/mindbody-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name, counts }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      setError(result.error ?? "Couldn't save that change.");
      setItems((current) => current.map((item) => (item.name === name ? { ...item, counts: !counts } : item)));
    }
  }

  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
      {items.length > 8 ? (
        <Input placeholder="Search" value={filter} onChange={(event) => setFilter(event.target.value)} className="sm:w-64" />
      ) : null}
      <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
        {shown.map((item) => (
          <li key={item.name}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
              <input type="checkbox" checked={item.counts} onChange={(event) => void toggle(item.name, event.target.checked)} />
              <span className="flex-1">{item.name}</span>
              <span className="text-xs text-muted-foreground">
                {item.guessed ? "Best guess · " : ""}seen {item.lastSeen}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
