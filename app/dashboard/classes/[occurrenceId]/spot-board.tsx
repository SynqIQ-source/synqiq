"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RoomMap } from "@/components/room-map";
import type { RoomLayout } from "@/lib/rooms/layout";

type Holder = { bookingId: string; spotId: string; name: string };

// The room for this class with who is on each spot. Staff tap a person,
// then a free spot, to move them.
export function SpotBoard({ layout, holders, manage }: { layout: RoomLayout; holders: Holder[]; manage: boolean }) {
  const router = useRouter();
  const [moving, setMoving] = useState<Holder | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const bySpot = new Map(holders.map((holder) => [holder.spotId, holder]));
  const names = new Map(holders.map((holder) => [holder.spotId, holder.name]));
  const taken = new Set(holders.map((holder) => holder.spotId));
  const free = layout.items.filter((item) => item.kind === "spot").length - taken.size;

  async function move(holder: Holder, spotId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bookings/${holder.bookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move_spot", spotId }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) setMessage({ ok: false, text: result.error ?? "Couldn't move them." });
      else {
        const label = layout.items.find((item) => item.id === spotId)?.label;
        setMessage({ ok: true, text: `${holder.name} moved to ${layout.spotNoun} ${label}.` });
      }
      setMoving(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {taken.size} taken, {free} free.
        {manage ? (moving ? ` Now tap a free ${layout.spotNoun.toLowerCase()} for ${moving.name}.` : " Tap someone to move them.") : ""}
      </p>
      <p className="text-center text-[11px] tracking-wide text-muted-foreground uppercase">Front of the room</p>
      <RoomMap
        layout={layout}
        taken={taken}
        names={names}
        selected={moving?.spotId ?? null}
        editing={manage}
        onCell={
          manage && !busy
            ? (_x, _y, item) => {
                if (!item || item.kind !== "spot") return;
                const holder = bySpot.get(item.id);
                if (holder) return setMoving(moving?.bookingId === holder.bookingId ? null : holder);
                if (moving) void move(moving, item.id);
              }
            : undefined
        }
      />
      {message ? (
        <p className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
