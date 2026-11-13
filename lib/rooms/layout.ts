// Room layouts (pick-a-spot). Pure; unit-tested in tests/room-layout.test.ts.

export const ITEM_KINDS = ["spot", "instructor", "door", "window", "mirror", "label"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type LayoutItem = { id: string; kind: ItemKind; x: number; y: number; label: string };
export type RoomLayout = { columns: number; rows: number; items: LayoutItem[]; spotNoun: string };

export const KIND_LABELS: Record<ItemKind, string> = {
  spot: "Spot",
  instructor: "Instructor",
  door: "Door",
  window: "Window",
  mirror: "Mirror",
  label: "Label",
};

const clampInt = (value: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value))));

// Clean up a layout from the editor: on the grid, one item per cell, known
// kinds, unique spot ids and labels, short text.
export function cleanLayout(input: unknown): { layout: RoomLayout } | { error: string } {
  const raw = (input ?? {}) as Partial<RoomLayout>;
  const columns = clampInt(raw.columns ?? 8, 2, 30);
  const rows = clampInt(raw.rows ?? 6, 2, 30);
  const spotNoun =
    String(raw.spotNoun ?? "Spot")
      .trim()
      .slice(0, 20) || "Spot";
  if (!Array.isArray(raw.items)) return { error: "The layout has no items." };
  if (raw.items.length > 400) return { error: "That's too many items for one room." };
  const cells = new Set<string>();
  const ids = new Set<string>();
  const labels = new Set<string>();
  const items: LayoutItem[] = [];
  for (const entry of raw.items as Partial<LayoutItem>[]) {
    const kind = entry.kind as ItemKind;
    if (!ITEM_KINDS.includes(kind)) return { error: "Unknown item in the layout." };
    const x = Math.round(Number(entry.x));
    const y = Math.round(Number(entry.y));
    if (!(x >= 0 && x < columns && y >= 0 && y < rows)) return { error: "Something is outside the room. Make the room bigger or move it." };
    const cell = `${x},${y}`;
    if (cells.has(cell)) return { error: "Two things are in the same square." };
    cells.add(cell);
    const id = String(entry.id ?? "").slice(0, 40);
    if (!/^[\w-]{1,40}$/.test(id) || ids.has(id)) return { error: "Two items share an id. Reload and try again." };
    ids.add(id);
    const label = String(entry.label ?? "")
      .trim()
      .slice(0, 12);
    if (kind === "spot") {
      if (!label) return { error: "Every spot needs a number or name." };
      if (labels.has(label.toLowerCase())) return { error: `Two spots are both called ${label}.` };
      labels.add(label.toLowerCase());
    }
    items.push({ id, kind, x, y, label });
  }
  return { layout: { columns, rows, items, spotNoun } };
}

export const spotsOf = (layout: RoomLayout) => layout.items.filter((item) => item.kind === "spot");

// Number the spots 1, 2, 3... front to back, left to right.
export function autoNumber(layout: RoomLayout): RoomLayout {
  const order = spotsOf(layout).sort((a, b) => a.y - b.y || a.x - b.x);
  const number = new Map(order.map((item, index) => [item.id, String(index + 1)]));
  return { ...layout, items: layout.items.map((item) => (number.has(item.id) ? { ...item, label: number.get(item.id)! } : item)) };
}

// A starting layout: rows of spots facing the instructor at the front.
export function starterLayout(spots: number, spotNoun = "Spot"): RoomLayout {
  const columns = Math.max(4, Math.min(12, Math.ceil(Math.sqrt(spots * 1.6))));
  const spotRows = Math.ceil(spots / columns);
  const items: LayoutItem[] = [{ id: "instructor", kind: "instructor", x: Math.floor(columns / 2), y: 0, label: "" }];
  for (let i = 0; i < spots; i += 1) {
    items.push({ id: `s${i + 1}`, kind: "spot", x: i % columns, y: 2 + Math.floor(i / columns), label: String(i + 1) });
  }
  return { columns, rows: spotRows + 3, items, spotNoun };
}

// The spot a booking gets: the one asked for if it's free; else (staff
// booking with no pick) the lowest-numbered free spot; null when none.
export function chooseSpot(
  layout: RoomLayout,
  taken: Set<string>,
  requested: string | null | undefined,
): { spot: LayoutItem | null; error?: string } {
  const spots = spotsOf(layout);
  if (requested) {
    const spot = spots.find((item) => item.id === requested);
    if (!spot) return { spot: null, error: "That spot isn't in this room." };
    if (taken.has(spot.id)) return { spot: null, error: `${layout.spotNoun} ${spot.label} was just taken. Pick another.` };
    return { spot };
  }
  const free = spots
    .filter((item) => !taken.has(item.id))
    .sort((a, b) => (Number(a.label) || Infinity) - (Number(b.label) || Infinity) || a.label.localeCompare(b.label));
  return { spot: free[0] ?? null };
}

export function parseLayout(
  row: { columns: unknown; rows: unknown; items: unknown; spot_noun?: unknown } | null | undefined,
): RoomLayout | null {
  if (!row) return null;
  const cleaned = cleanLayout({ columns: row.columns, rows: row.rows, items: row.items, spotNoun: row.spot_noun });
  return "layout" in cleaned ? cleaned.layout : null;
}
