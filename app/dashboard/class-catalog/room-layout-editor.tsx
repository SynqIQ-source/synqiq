"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RoomMap } from "@/components/room-map";
import {
  ITEM_KINDS,
  KIND_LABELS,
  autoNumber,
  spotsOf,
  starterLayout,
  type ItemKind,
  type LayoutItem,
  type RoomLayout,
} from "@/lib/rooms/layout";

export type SavedLayout = { id: string; name: string; isDefault: boolean; classTypeIds: string[]; layout: RoomLayout };
type ClassTypeOption = { id: string; name: string; inRoom: boolean };

// Club Admin: design a room for pick-a-spot booking. Pick a tool and tap
// squares to place things; drag anything to move it; tap an item to rename
// or remove it. A room has a main layout and can have others used only by
// certain classes (Beat on mats in the Cycle room).
export function RoomLayoutEditor({
  roomId,
  roomName,
  record,
  classTypes,
  hasMain,
}: {
  roomId: string;
  roomName: string;
  record: SavedLayout | null; // null = a new layout
  classTypes: ClassTypeOption[];
  hasMain: boolean;
}) {
  const router = useRouter();
  const initial = record?.layout ?? null;
  const [open, setOpen] = useState(false);
  const [layoutId, setLayoutId] = useState<string | null>(record?.id ?? null);
  const [name, setName] = useState(record?.name ?? (hasMain ? "" : "Main layout"));
  const [isDefault, setIsDefault] = useState(record?.isDefault ?? !hasMain);
  const [classTypeIds, setClassTypeIds] = useState<string[]>(record?.classTypeIds ?? []);
  const [layout, setLayout] = useState<RoomLayout | null>(initial);
  const [tool, setTool] = useState<ItemKind>("spot");
  const [selected, setSelected] = useState<string | null>(null);
  const [starter, setStarter] = useState(20);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const item = layout?.items.find((entry) => entry.id === selected) ?? null;
  const update = (next: RoomLayout) => {
    setLayout(next);
    setMessage(null);
  };
  const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const nextSpotLabel = (current: RoomLayout) => {
    const used = new Set(spotsOf(current).map((spot) => spot.label));
    let n = 1;
    while (used.has(String(n))) n += 1;
    return String(n);
  };

  function onCell(x: number, y: number, existing: LayoutItem | null) {
    if (!layout) return;
    if (existing) return setSelected(existing.id === selected ? null : existing.id);
    if (selected && item) {
      // Tap an empty square with something selected: move it there.
      update({ ...layout, items: layout.items.map((entry) => (entry.id === item.id ? { ...entry, x, y } : entry)) });
      return;
    }
    const label = tool === "spot" ? nextSpotLabel(layout) : tool === "label" ? "Label" : "";
    const added = { id: newId(), kind: tool, x, y, label };
    update({ ...layout, items: [...layout.items, added] });
    if (tool === "label") setSelected(added.id);
  }

  function onItemPointerDown(entry: LayoutItem, event: React.PointerEvent) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(entry.id);
    const finish = (up: PointerEvent) => {
      window.removeEventListener("pointerup", finish);
      setDragging(null);
      const target = (document.elementFromPoint(up.clientX, up.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-cell]");
      const cell = target?.dataset.cell;
      if (!cell) return;
      const [x, y] = cell.split(",").map(Number);
      if (x === entry.x && y === entry.y) return;
      setLayout((current) => {
        if (!current || current.items.some((other) => other.x === x && other.y === y)) return current;
        return { ...current, items: current.items.map((other) => (other.id === entry.id ? { ...other, x, y } : other)) };
      });
      setSelected(entry.id);
    };
    window.addEventListener("pointerup", finish);
  }

  async function save() {
    if (!layout) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...layout, layoutId, name, isDefault, classTypeIds }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; id?: string };
      if (!response.ok || !result.success) return setMessage({ ok: false, text: result.error ?? "Couldn't save." });
      if (result.id) setLayoutId(result.id);
      const who = isDefault
        ? `Classes in ${roomName}`
        : classTypes
            .filter((type) => classTypeIds.includes(type.id))
            .map((type) => type.name)
            .join(", ") + " classes";
      setMessage({ ok: true, text: `Saved. ${who} now let members pick a ${layout.spotNoun.toLowerCase()}.` });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    if (layoutId) await fetch(`/api/rooms/${roomId}/layout?layoutId=${layoutId}`, { method: "DELETE" });
    setSaving(false);
    setLayout(null);
    setLayoutId(null);
    setSelected(null);
    setMessage({ ok: true, text: isDefault ? "Layout removed." : "Layout removed. Those classes use the room's main layout again." });
    router.refresh();
  }

  const spotCount = layout ? spotsOf(layout).length : 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {record ? (
          <Button size="sm" variant="outline">
            <LayoutGrid /> {record.name} ({spotsOf(record.layout).length} {record.layout.spotNoun.toLowerCase()}s)
          </Button>
        ) : hasMain ? (
          <Button size="sm" variant="ghost">
            <Plus /> Layout for certain classes
          </Button>
        ) : (
          <Button size="sm" variant="ghost">
            <LayoutGrid /> Design layout
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {roomName}: {name || (isDefault ? "Main layout" : "New layout")}
          </DialogTitle>
          <DialogDescription>
            Members pick their spot when they book a class in this room. Pick a tool and tap squares to place things; drag to move; tap
            something to rename or remove it. The front of the room is the top.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border p-3 text-sm">
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Layout name</span>
            <Input
              className="h-8 w-56"
              value={name}
              maxLength={40}
              placeholder={isDefault ? "Main layout" : "e.g. Beat (mats)"}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="space-y-1">
            <label className="flex items-center gap-2">
              <input type="radio" checked={isDefault} onChange={() => setIsDefault(true)} />
              Main layout: every class in {roomName} unless another layout is set for it
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!isDefault} onChange={() => setIsDefault(false)} />
              Only for these classes:
            </label>
            {!isDefault ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
                {classTypes.map((type) => (
                  <label key={type.id} className={`flex items-center gap-1.5 ${type.inRoom ? "" : "text-muted-foreground"}`}>
                    <input
                      type="checkbox"
                      checked={classTypeIds.includes(type.id)}
                      onChange={(e) =>
                        setClassTypeIds(e.target.checked ? [...classTypeIds, type.id] : classTypeIds.filter((id) => id !== type.id))
                      }
                    />
                    {type.name}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {!layout ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-4">
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">How many spots?</span>
              <Input
                type="number"
                min={1}
                max={200}
                className="h-9 w-24"
                value={starter}
                onChange={(e) => setStarter(Number(e.target.value))}
              />
            </label>
            <Button
              onClick={() =>
                update(
                  starterLayout(
                    Math.max(1, Math.min(200, starter || 1)),
                    !isDefault
                      ? "Mat"
                      : roomName.match(/cycle/i)
                        ? "Bike"
                        : roomName.match(/pilates/i)
                          ? "Reformer"
                          : roomName.match(/pool/i)
                            ? "Lane"
                            : "Spot",
                  ),
                )
              }
            >
              Start a layout
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm">
                <span className="block text-muted-foreground">Each spot is a</span>
                <Input className="h-9 w-28" value={layout.spotNoun} onChange={(e) => update({ ...layout, spotNoun: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-muted-foreground">Columns</span>
                <Input
                  type="number"
                  min={2}
                  max={30}
                  className="h-9 w-20"
                  value={layout.columns}
                  onChange={(e) => update({ ...layout, columns: Math.max(2, Math.min(30, Number(e.target.value) || 2)) })}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-muted-foreground">Rows</span>
                <Input
                  type="number"
                  min={2}
                  max={30}
                  className="h-9 w-20"
                  value={layout.rows}
                  onChange={(e) => update({ ...layout, rows: Math.max(2, Math.min(30, Number(e.target.value) || 2)) })}
                />
              </label>
              <Button variant="outline" size="sm" className="h-9" onClick={() => update(autoNumber(layout))}>
                Number spots 1, 2, 3…
              </Button>
              <span className="text-sm text-muted-foreground">
                {spotCount} {layout.spotNoun.toLowerCase()}
                {spotCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex flex-wrap gap-1">
              {ITEM_KINDS.map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={tool === kind && !selected ? "default" : "outline"}
                  onClick={() => {
                    setTool(kind);
                    setSelected(null);
                  }}
                >
                  {kind === "spot" ? layout.spotNoun || "Spot" : KIND_LABELS[kind]}
                </Button>
              ))}
            </div>

            {item ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <span className="font-medium">{item.kind === "spot" ? layout.spotNoun : KIND_LABELS[item.kind]}</span>
                {item.kind === "spot" || item.kind === "label" ? (
                  <Input
                    aria-label="Name"
                    className="h-8 w-32"
                    value={item.label}
                    maxLength={12}
                    onChange={(e) =>
                      update({
                        ...layout,
                        items: layout.items.map((entry) => (entry.id === item.id ? { ...entry, label: e.target.value } : entry)),
                      })
                    }
                  />
                ) : null}
                <span className="text-xs text-muted-foreground">Tap an empty square to move it there.</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-destructive"
                  onClick={() => {
                    update({ ...layout, items: layout.items.filter((entry) => entry.id !== item.id) });
                    setSelected(null);
                  }}
                >
                  <Trash2 /> Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  Done
                </Button>
              </div>
            ) : null}

            <div className={`rounded-lg border bg-muted/30 p-3 ${dragging ? "cursor-grabbing" : ""}`}>
              <p className="mb-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">Front of the room</p>
              <RoomMap layout={layout} selected={selected} editing onCell={onCell} onItemPointerDown={onItemPointerDown} />
            </div>

            {message ? (
              <p className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" className="text-destructive" disabled={saving} onClick={remove}>
                Remove layout
              </Button>
              <Button disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save layout"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
