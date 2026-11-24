"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reorderNeed } from "@/lib/pos/stock";
import type { InventoryCategory } from "./catalog-editor";
import { ItemPhotoButton } from "./item-photo";

export type StockRow = {
  id: string;
  name: string;
  imageUrl: string | null;
  inventoryCategoryId: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  onHand: number | null;
  countedAt: string | null;
  countedQuantity: number | null;
  receivedSince: number;
  soldSince: number;
  history: { kind: "count" | "received"; quantity: number; at: string; note: string | null; by: string | null }[];
};

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
const NONE = "__none";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

async function act(body: Record<string, unknown>) {
  try {
    const response = await fetch("/api/pos/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    return response.ok && result.success ? null : (result.error ?? "Couldn't save. Try again.");
  } catch {
    return "Couldn't reach SynqIQ. Try again.";
  }
}

// Products & Inventory -> Inventory on hand: every retail product with its
// PAR, reorder level and on hand (latest count + received - sold since).
export function StockOnHand({ rows, inventoryCategories }: { rows: StockRow[]; inventoryCategories: InventoryCategory[] }) {
  const [search, setSearch] = useState("");
  const [top, setTop] = useState("all");
  const [sub, setSub] = useState("all");
  const [onlyReorder, setOnlyReorder] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(inventoryCategories.map((c) => [c.id, c])), [inventoryCategories]);
  const order = (a: InventoryCategory, b: InventoryCategory) => a.sort - b.sort || a.name.localeCompare(b.name);
  const tops = inventoryCategories.filter((c) => !c.parentId).sort(order);
  const subs = top !== "all" && top !== NONE ? inventoryCategories.filter((c) => c.parentId === top).sort(order) : [];

  const placed = (row: StockRow) => {
    const own = row.inventoryCategoryId ? byId.get(row.inventoryCategoryId) : undefined;
    if (!own) return { top: NONE, sub: null as string | null };
    return own.parentId ? { top: own.parentId, sub: own.id } : { top: own.id, sub: null };
  };
  const shown = rows
    .filter((row) => {
      const place = placed(row);
      if (top !== "all" && place.top !== top) return false;
      if (sub !== "all" && place.sub !== sub) return false;
      if (search.trim() && !row.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (onlyReorder && !reorderNeed(row.onHand, row.parLevel, row.reorderLevel).reorder) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const needReorder = rows.filter((row) => reorderNeed(row.onHand, row.parLevel, row.reorderLevel).reorder).length;
  const notCounted = rows.filter((row) => row.onHand == null).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 w-56" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select
          aria-label="Category"
          className={selectClass}
          value={top}
          onChange={(e) => {
            setTop(e.target.value);
            setSub("all");
          }}
        >
          <option value="all">All categories</option>
          {tops.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NONE}>Not in a category</option>
        </select>
        {subs.length ? (
          <select aria-label="Sub-category" className={selectClass} value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="all">All sub-categories</option>
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={onlyReorder} onChange={(e) => setOnlyReorder(e.target.checked)} />
          Needs reorder only
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        {rows.length} retail products · <span className={needReorder ? "font-medium text-destructive" : ""}>{needReorder} to reorder</span>{" "}
        · {notCounted} not counted yet. On hand = the last count + deliveries received since − sold since. Practice sales don&apos;t change
        stock, and neither do sales still rung up in Mindbody.
      </p>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Photo</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="w-24 text-right">PAR</TableHead>
              <TableHead className="w-24 text-right">Reorder at</TableHead>
              <TableHead className="w-40 text-right">On hand</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nothing matches.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((row) => (
                <Fragment key={row.id}>
                  <StockLine row={row} open={open === row.id} onToggle={() => setOpen(open === row.id ? null : row.id)} />
                  {open === row.id ? <StockUpdate row={row} /> : null}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StockLine({ row, open, onToggle }: { row: StockRow; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [par, setPar] = useState(row.parLevel == null ? "" : String(row.parLevel));
  const [reorderAt, setReorderAt] = useState(row.reorderLevel == null ? "" : String(row.reorderLevel));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    par !== (row.parLevel == null ? "" : String(row.parLevel)) || reorderAt !== (row.reorderLevel == null ? "" : String(row.reorderLevel));
  const need = reorderNeed(row.onHand, row.parLevel, row.reorderLevel);
  const digits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 6);

  return (
    <TableRow>
      <TableCell>
        <ItemPhotoButton itemId={row.id} imageUrl={row.imageUrl} name={row.name} />
      </TableCell>
      <TableCell className="font-medium whitespace-normal">
        {row.name}
        {error ? <span className="block text-xs font-normal text-destructive">{error}</span> : null}
      </TableCell>
      <TableCell className="text-right">
        <Input
          aria-label={`PAR for ${row.name}`}
          className="ml-auto h-8 w-20 text-right tabular-nums"
          inputMode="numeric"
          placeholder="—"
          value={par}
          onChange={(e) => setPar(digits(e.target.value))}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          aria-label={`Reorder level for ${row.name}`}
          className="ml-auto h-8 w-20 text-right tabular-nums"
          inputMode="numeric"
          placeholder="—"
          value={reorderAt}
          onChange={(e) => setReorderAt(digits(e.target.value))}
        />
      </TableCell>
      <TableCell className="text-right whitespace-normal">
        {row.onHand == null ? (
          <span className="text-muted-foreground">Not counted</span>
        ) : (
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="flex items-center gap-1.5">
              {need.reorder ? <Badge variant="destructive">Reorder</Badge> : null}
              <span className={`text-base font-semibold tabular-nums ${row.onHand < 0 ? "text-destructive" : ""}`}>{row.onHand}</span>
            </span>
            {need.toOrder ? <span className="text-xs text-muted-foreground">order {need.toOrder} to reach PAR</span> : null}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {dirty ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const problem = await act({ action: "stockLevels", id: row.id, parLevel: par, reorderLevel: reorderAt });
              setBusy(false);
              setError(problem);
              if (!problem) router.refresh();
            }}
          >
            Save
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onToggle}>
            Update {open ? <ChevronUp /> : <ChevronDown />}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// Log a delivery or a count, and see the recent history.
function StockUpdate({ row }: { row: StockRow }) {
  const router = useRouter();
  const [received, setReceived] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const digits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 6);

  async function save(kind: "received" | "count", quantity: string) {
    setBusy(true);
    const problem = await act({ action: "stockMove", id: row.id, kind, quantity, note });
    setBusy(false);
    setMessage(problem ?? (kind === "received" ? `Added ${quantity} received.` : `On hand set to ${quantity}.`));
    if (!problem) {
      setReceived("");
      setCounted("");
      setNote("");
      router.refresh();
    }
  }

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={6} className="whitespace-normal">
        <div className="flex flex-wrap items-end gap-4 py-1">
          <div className="flex items-end gap-1.5">
            <label className="text-sm">
              Delivery received
              <Input
                className="h-8 w-24 tabular-nums"
                inputMode="numeric"
                placeholder="How many"
                value={received}
                onChange={(e) => setReceived(digits(e.target.value))}
              />
            </label>
            <Button size="sm" variant="outline" disabled={busy || !received || received === "0"} onClick={() => save("received", received)}>
              Add to on hand
            </Button>
          </div>
          <div className="flex items-end gap-1.5">
            <label className="text-sm">
              {row.onHand == null ? "Starting inventory" : "Counted on the shelf"}
              <Input
                className="h-8 w-24 tabular-nums"
                inputMode="numeric"
                placeholder="Count"
                value={counted}
                onChange={(e) => setCounted(digits(e.target.value))}
              />
            </label>
            <Button size="sm" variant="outline" disabled={busy || counted === ""} onClick={() => save("count", counted)}>
              Set on hand
            </Button>
          </div>
          <label className="min-w-48 flex-1 text-sm">
            Note (optional)
            <Input className="h-8" placeholder="e.g. PO 1042, damaged box" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {message ? <p className="pt-1 text-sm text-muted-foreground">{message}</p> : null}
        <div className="pt-2 text-xs text-muted-foreground">
          {row.countedAt ? (
            <p>
              Last count {row.countedQuantity} on {day(row.countedAt)} · +{row.receivedSince} received · −{row.soldSince} sold since
            </p>
          ) : (
            <p>Enter the starting inventory to begin tracking this product.</p>
          )}
          {row.history.length ? (
            <ul className="mt-1 space-y-0.5">
              {row.history.map((entry, index) => (
                <li key={index}>
                  {day(entry.at)}: {entry.kind === "count" ? `counted ${entry.quantity}` : `received ${entry.quantity}`}
                  {entry.by ? ` · ${entry.by}` : ""}
                  {entry.note ? ` · ${entry.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
