"use client";

import type { LayoutItem, RoomLayout } from "@/lib/rooms/layout";

// A room layout drawn on its grid: spots (bikes, reformers, mats, lanes),
// the instructor, doors, windows, mirrors and labels. Used by the layout
// designer, the member spot picker and the staff roster.
export function RoomMap({
  layout,
  taken = new Set<string>(),
  mine,
  selected,
  color = "#0f766e",
  onCell,
  onItemPointerDown,
  editing = false,
  names,
}: {
  layout: RoomLayout;
  taken?: Set<string>;
  mine?: string | null;
  selected?: string | null;
  color?: string;
  onCell?: (x: number, y: number, item: LayoutItem | null) => void;
  onItemPointerDown?: (item: LayoutItem, event: React.PointerEvent) => void;
  editing?: boolean;
  names?: Map<string, string>; // spot id -> who's in it (staff roster)
}) {
  const at = new Map(layout.items.map((item) => [`${item.x},${item.y}`, item]));
  const cells = [];
  for (let y = 0; y < layout.rows; y += 1) {
    for (let x = 0; x < layout.columns; x += 1) {
      const item = at.get(`${x},${y}`) ?? null;
      cells.push(
        <Cell
          key={`${x},${y}`}
          item={item}
          isTaken={Boolean(item && taken.has(item.id))}
          isMine={Boolean(item && mine === item.id)}
          isSelected={Boolean(item && selected === item.id)}
          color={color}
          editing={editing}
          name={item ? names?.get(item.id) : undefined}
          spotNoun={layout.spotNoun}
          onClick={onCell ? () => onCell(x, y, item) : undefined}
          onPointerDown={item && onItemPointerDown ? (event) => onItemPointerDown(item, event) : undefined}
          dataCell={`${x},${y}`}
        />,
      );
    }
  }
  return (
    <div className="w-full overflow-x-auto">
      <div
        className="mx-auto grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(${names ? 64 : 36}px, 1fr))`,
          maxWidth: layout.columns * (names ? 96 : 64),
        }}
      >
        {cells}
      </div>
    </div>
  );
}

function Cell({
  item,
  isTaken,
  isMine,
  isSelected,
  color,
  editing,
  name,
  spotNoun,
  onClick,
  onPointerDown,
  dataCell,
}: {
  item: LayoutItem | null;
  isTaken: boolean;
  isMine: boolean;
  isSelected: boolean;
  color: string;
  editing: boolean;
  name?: string;
  spotNoun: string;
  onClick?: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  dataCell: string;
}) {
  const ring = isSelected ? { boxShadow: `0 0 0 3px ${color}` } : undefined;
  const base = "flex aspect-square min-h-9 items-center justify-center rounded-md text-xs select-none touch-none";
  if (!item) {
    return (
      <button
        type="button"
        data-cell={dataCell}
        onClick={onClick}
        disabled={!onClick}
        aria-label="Empty"
        className={`${base} ${editing ? "border border-dashed border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" : ""}`}
      />
    );
  }
  if (item.kind === "spot") {
    const style = isMine ? { background: color, color: "white", ...ring } : isTaken ? ring : { borderColor: color, color, ...ring };
    return (
      <button
        type="button"
        data-cell={dataCell}
        onClick={onClick}
        onPointerDown={onPointerDown}
        disabled={!onClick || (!editing && isTaken && !isMine)}
        aria-label={`${spotNoun} ${item.label}${isMine ? " (yours)" : isTaken ? " (taken)" : ""}`}
        className={`${base} flex-col border-2 font-semibold ${
          isTaken && !isMine
            ? "border-neutral-300 bg-neutral-200 text-neutral-400 line-through dark:border-neutral-700 dark:bg-neutral-800"
            : "bg-white dark:bg-neutral-950"
        } ${editing ? "cursor-grab" : ""}`}
        style={style}
      >
        <span className="text-sm leading-none">{item.label}</span>
        {name ? <span className="mt-0.5 max-w-full truncate px-0.5 text-[10px] font-normal no-underline">{name}</span> : null}
      </button>
    );
  }
  const text =
    item.kind === "instructor" ? "Instructor" : item.kind === "label" ? item.label : item.kind[0].toUpperCase() + item.kind.slice(1);
  const look =
    item.kind === "instructor"
      ? "rounded-full bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
      : item.kind === "mirror"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
        : item.kind === "window"
          ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300"
          : item.kind === "door"
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "text-neutral-600 dark:text-neutral-300";
  return (
    <button
      type="button"
      data-cell={dataCell}
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={!onClick}
      className={`${base} px-0.5 text-[10px] leading-tight font-medium ${look} ${editing ? "cursor-grab" : ""}`}
      style={ring}
    >
      <span className="line-clamp-2 text-center">{text}</span>
    </button>
  );
}
