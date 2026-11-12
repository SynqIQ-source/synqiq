"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, ImageIcon, Pencil, Plus, RefreshCw, ScanBarcode, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PromoCodes, type PromoRow } from "./promo-codes";

export type CatalogCategory = { id: string; key: string; name: string; taxable: boolean; glAccount: string; active: boolean };
export type InventoryCategory = { id: string; parentId: string | null; name: string; sort: number };
export type PackagePartRow = { label: string; revenueCategoryId: string; amountCents: number; recurring: boolean };
export type CatalogItem = {
  id: string;
  kind: "product" | "service" | "membership";
  source: string;
  name: string;
  priceCents: number;
  categoryId: string;
  taxable: "category" | "yes" | "no";
  barcode: string;
  imageUrl: string | null;
  sessions: number | null;
  active: boolean;
  mindbodyName: string | null;
  mindbodyPriceCents: number | null;
  mindbodyGroup: string | null;
  mindbodyDiscontinued: boolean;
  inventoryCategoryId: string;
  packageParts: PackagePartRow[] | null;
  autopayCount: number | null;
  autoRenews: boolean;
  openPrice: boolean;
};

const KIND_LABELS = { product: "Retail", service: "Pack / service", membership: "Membership" } as const;
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function act(body: Record<string, unknown>) {
  try {
    const response = await fetch("/api/pos/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string } & Record<string, unknown>;
    return response.ok && result.success
      ? { error: null, data: result }
      : { error: result.error ?? "Couldn't save. Try again.", data: undefined };
  } catch {
    return { error: "Couldn't reach SynqIQ. Try again.", data: undefined };
  }
}

export function CatalogEditor({
  items,
  categories,
  inventoryCategories,
  taxPercent,
  lastSync,
  promos,
}: {
  items: CatalogItem[];
  categories: CatalogCategory[];
  inventoryCategories: InventoryCategory[];
  taxPercent: number;
  lastSync: string | null;
  promos: PromoRow[];
}) {
  const [tab, setTab] = useState<"items" | "categories" | "promos">("items");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b">
        {(
          [
            ["items", "Items"],
            ["categories", "Revenue categories & tax"],
            ["promos", "Promo codes"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "items" ? (
        <Items items={items} categories={categories} inventoryCategories={inventoryCategories} lastSync={lastSync} />
      ) : null}
      {tab === "categories" ? <Categories categories={categories} items={items} taxPercent={taxPercent} /> : null}
      {tab === "promos" ? <PromoCodes promos={promos} categories={categories} /> : null}
    </div>
  );
}

const UNSORTED = "__unsorted";

function Items({
  items,
  categories,
  inventoryCategories,
  lastSync,
}: {
  items: CatalogItem[];
  categories: CatalogCategory[];
  inventoryCategories: InventoryCategory[];
  lastSync: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // inventory category being browsed
  const [managing, setManaging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c]));
  const uncategorized = items.filter((item) => item.active && !item.categoryId).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((item) => (showInactive ? true : item.active))
      .filter((item) => (kind === "all" ? true : item.kind === kind))
      .filter((item) => (category === "all" ? true : category === "none" ? !item.categoryId : item.categoryId === category))
      .filter((item) => !q || item.name.toLowerCase().includes(q) || item.barcode === search.trim());
  }, [items, search, category, kind, showInactive]);
  const editing = items.find((item) => item.id === selected) ?? null;

  // Browsing: category cards -> sub-category cards -> items. Any search or
  // filter shows a flat list instead.
  const browsing = !search.trim() && category === "all" && kind === "all";
  const invBy = new Map(inventoryCategories.map((c) => [c.id, c]));
  const placeOf = (item: CatalogItem) =>
    item.inventoryCategoryId && invBy.has(item.inventoryCategoryId) ? item.inventoryCategoryId : UNSORTED;
  const visible = items.filter((item) => showInactive || item.active);
  const countUnder = (id: string) =>
    visible.filter((item) => placeOf(item) === id || (id !== UNSORTED && invBy.get(placeOf(item))?.parentId === id)).length;
  const coverUnder = (id: string) =>
    visible.find((item) => item.imageUrl && (placeOf(item) === id || invBy.get(placeOf(item))?.parentId === id))?.imageUrl ?? null;
  const open = openId === UNSORTED ? null : openId ? (invBy.get(openId) ?? null) : null;
  const level = inventoryCategories.filter((c) => c.parentId === (openId === UNSORTED ? "none" : (openId ?? null)));
  const levelSorted = [...level].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const cards = browsing && !managing ? levelSorted : [];
  const unsortedCount = countUnder(UNSORTED);
  const itemsHere = browsing ? (openId ? visible.filter((item) => placeOf(item) === openId) : []) : shown;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative">
          <ScanBarcode className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            className="h-9 w-64 pl-8"
            placeholder="Search or scan a barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // The scanner types the barcode then Enter: open that item.
              if (e.key === "Enter") {
                const hit = items.find((item) => item.barcode && item.barcode === search.trim());
                if (hit) {
                  setSelected(hit.id);
                  setSearch("");
                }
              }
            }}
          />
        </div>
        <select aria-label="Category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          <option value="none">Needs a category ({uncategorized})</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Type" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All types</option>
          <option value="product">Retail</option>
          <option value="service">Packs & services</option>
          <option value="membership">Memberships</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show hidden
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelected("new")}>
            Add item
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={importing}
            onClick={async () => {
              setImporting(true);
              setMessage(null);
              const result = await act({ action: "import" });
              setImporting(false);
              setMessage(
                result.error ??
                  `Mindbody: ${result.data?.products} retail, ${result.data?.services} packs/services, ${result.data?.memberships} memberships. ${result.data?.added} new, ${result.data?.deactivated} no longer active.`,
              );
              router.refresh();
            }}
          >
            <RefreshCw className={importing ? "animate-spin" : ""} /> {importing ? "Importing…" : "Pull from Mindbody"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {message ??
          (lastSync
            ? `Last pulled from Mindbody ${new Date(lastSync).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. Only active items come over; SynqIQ edits are kept.`
            : "Nothing imported yet. Pull from Mindbody brings over active retail products, packs and services, and memberships.")}
      </p>
      {uncategorized ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {uncategorized} item{uncategorized === 1 ? " needs" : "s need"} a revenue category before {uncategorized === 1 ? "it" : "they"}{" "}
          can be sold.{" "}
          <button type="button" className="underline" onClick={() => setCategory("none")}>
            Show them
          </button>
        </p>
      ) : null}

      {selected ? (
        <ItemEditor
          key={selected}
          item={editing}
          categories={categories}
          inventoryCategories={inventoryCategories}
          defaultInventoryCategoryId={openId && openId !== UNSORTED ? openId : ""}
          onClose={() => {
            setSelected(null);
            searchRef.current?.focus();
          }}
        />
      ) : null}

      {browsing ? (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" className={openId ? "text-primary underline" : "font-medium"} onClick={() => setOpenId(null)}>
            All categories
          </button>
          {open?.parentId ? (
            <>
              <ChevronRight className="size-3 text-muted-foreground" />
              <button type="button" className="text-primary underline" onClick={() => setOpenId(open.parentId)}>
                {invBy.get(open.parentId)?.name}
              </button>
            </>
          ) : null}
          {openId ? (
            <>
              <ChevronRight className="size-3 text-muted-foreground" />
              <span className="font-medium">{open?.name ?? "Not in a category"}</span>
            </>
          ) : null}
          {openId !== UNSORTED && !open?.parentId && !managing ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setManaging(true)}>
              <Pencil /> {open ? "Edit sub-categories" : "Edit categories"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {browsing && managing ? <CategoryManager level={level} parent={open} onDone={() => setManaging(false)} /> : null}
      {cards.length || (browsing && !openId && !managing && unsortedCount) ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[...cards, ...(!openId && unsortedCount ? [{ id: UNSORTED, parentId: null, name: "Not in a category", sort: 0 }] : [])].map(
            (c) => {
              const cover = c.id === UNSORTED ? null : coverUnder(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-sm"
                >
                  <div className="flex aspect-[16/9] items-center justify-center bg-muted">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="text-3xl font-semibold text-muted-foreground/60">{c.name.trim().charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-2">
                    <p className="font-medium">{c.name}</p>
                    <span className="text-xs text-muted-foreground tabular-nums">{countUnder(c.id)}</span>
                  </div>
                </button>
              );
            },
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {itemsHere.map((item) => {
          const cat = categoryName.get(item.categoryId);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`group overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-sm ${item.active ? "" : "opacity-50"} ${selected === item.id ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-3xl font-semibold text-muted-foreground/60">{item.name.trim().charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="space-y-1 p-2">
                <p className="line-clamp-2 text-sm leading-tight font-medium">{item.name}</p>
                <p className="text-sm tabular-nums">{money(item.priceCents)}</p>
                <div className="flex flex-wrap gap-1">
                  {cat ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {cat.name}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      No category
                    </Badge>
                  )}
                  {item.packageParts ? (
                    <Badge variant="outline" className="text-[10px]">
                      Package
                    </Badge>
                  ) : null}
                  {!item.active ? (
                    <Badge variant="outline" className="text-[10px]">
                      Hidden
                    </Badge>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {(!browsing || openId) && itemsHere.length === 0 && cards.length === 0 && !managing ? (
        <p className="text-sm text-muted-foreground">{browsing ? "Nothing here yet." : "Nothing matches."}</p>
      ) : null}
    </div>
  );
}

function ItemEditor({
  item,
  categories,
  inventoryCategories,
  defaultInventoryCategoryId,
  onClose,
}: {
  item: CatalogItem | null;
  categories: CatalogCategory[];
  inventoryCategories: InventoryCategory[];
  defaultInventoryCategoryId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? (item.priceCents / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [taxable, setTaxable] = useState<CatalogItem["taxable"]>(item?.taxable ?? "category");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [openPrice, setOpenPrice] = useState(item?.openPrice ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [kind, setKind] = useState<CatalogItem["kind"]>(item?.kind ?? "product");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? null);
  const [inventoryCategoryId, setInventoryCategoryId] = useState(item ? item.inventoryCategoryId : defaultInventoryCategoryId);
  const [parts, setParts] = useState<PartDraft[] | null>(
    item?.packageParts?.map((part) => ({
      label: part.label,
      revenueCategoryId: part.revenueCategoryId,
      amount: (part.amountCents / 100).toFixed(2),
      recurring: part.recurring,
    })) ?? null,
  );
  const [autopayCount, setAutopayCount] = useState(item?.autopayCount == null ? "" : String(item.autopayCount));
  const [autoRenews, setAutoRenews] = useState(item?.autoRenews ?? false);
  const partsTotal = parts ? parts.reduce((sum, part) => sum + Math.round(Number(part.amount || 0) * 100), 0) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const category = categories.find((c) => c.id === categoryId);
  const taxed = taxable === "yes" || (taxable === "category" && Boolean(category?.taxable));

  async function save() {
    setBusy(true);
    setError(null);
    const result = await act({
      action: "item",
      id: item?.id,
      kind,
      name,
      price: partsTotal != null ? (partsTotal / 100).toFixed(2) : price,
      revenueCategoryId: categoryId || null,
      taxable,
      barcode,
      active,
      inventoryCategoryId: inventoryCategoryId || null,
      openPrice,
      packageParts: parts
        ? parts.map((part) => ({
            label: part.label,
            revenueCategoryId: part.revenueCategoryId,
            amountCents: Math.round(Number(part.amount || 0) * 100),
            recurring: part.recurring,
          }))
        : null,
      autopayCount: autopayCount.trim() === "" ? null : Number(autopayCount),
      autoRenews,
    });
    setBusy(false);
    if (result.error) return setError(result.error);
    router.refresh();
    onClose();
  }

  async function upload(file: File) {
    if (!item) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("image", file);
    const response = await fetch(`/api/pos/items/${item.id}/image`, { method: "POST", body: form });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; imageUrl?: string };
    setBusy(false);
    if (!response.ok || !result.success) return setError(result.error ?? "Couldn't upload. Try again.");
    setImageUrl(result.imageUrl ?? null);
    router.refresh();
  }

  async function removeImage() {
    if (!item) return;
    setBusy(true);
    await fetch(`/api/pos/items/${item.id}/image`, { method: "DELETE" });
    setBusy(false);
    setImageUrl(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item ? item.name : "Add an item"}</CardTitle>
        <CardDescription>
          {item
            ? `${KIND_LABELS[item.kind]}${item.source === "mindbody" ? ` · from Mindbody${item.mindbodyGroup ? ` (${item.mindbodyGroup})` : ""}${item.mindbodyPriceCents != null && item.mindbodyPriceCents !== item.priceCents ? ` · Mindbody price ${money(item.mindbodyPriceCents)}` : ""}` : " · added in SynqIQ"}${item.sessions && item.sessions < 9999 ? ` · ${item.sessions} sessions` : ""}`
            : "A new item to sell at the checkout."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6">
        <div className="space-y-2">
          <div className="flex size-40 items-center justify-center overflow-hidden rounded-xl border bg-muted">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <ImageIcon className="size-8 text-muted-foreground" />
            )}
          </div>
          {item ? (
            <div className="flex flex-col gap-1">
              <label className="cursor-pointer text-sm text-primary underline">
                {imageUrl ? "Replace picture" : "Upload a picture"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(file);
                  }}
                />
              </label>
              {imageUrl ? (
                <button type="button" className="text-left text-sm text-muted-foreground underline" onClick={removeImage}>
                  Remove picture
                </button>
              ) : null}
              <span className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 3 MB. Square works best.</span>
            </div>
          ) : (
            <p className="w-40 text-xs text-muted-foreground">Save the item first, then add a picture.</p>
          )}
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-sm">
            Price{parts ? " (first payment)" : ""}
            <Input
              inputMode="decimal"
              disabled={Boolean(parts)}
              value={partsTotal != null ? (partsTotal / 100).toFixed(2) : price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          {!item ? (
            <label className="text-sm">
              Type
              <select
                className={`${selectClass} block w-full`}
                value={kind}
                onChange={(e) => setKind(e.target.value as CatalogItem["kind"])}
              >
                <option value="product">Retail</option>
                <option value="service">Pack / service</option>
                <option value="membership">Membership</option>
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            Inventory category
            <select
              className={`${selectClass} block w-full`}
              value={inventoryCategoryId}
              onChange={(e) => setInventoryCategoryId(e.target.value)}
            >
              <option value="">Not in a category</option>
              {orderedInventoryCategories(inventoryCategories).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Revenue category (tax &amp; accounting)
            <select className={`${selectClass} block w-full`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Pick one…</option>
              {categories
                .filter((c) => c.active || c.id === categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Sales tax
            <select
              className={`${selectClass} block w-full`}
              value={taxable}
              onChange={(e) => setTaxable(e.target.value as CatalogItem["taxable"])}
            >
              <option value="category">
                Same as category ({category ? (category.taxable ? "taxed" : "not taxed") : "pick a category"})
              </option>
              <option value="yes">Always taxed</option>
              <option value="no">Never taxed</option>
            </select>
          </label>
          <label className="text-sm">
            Barcode
            <Input placeholder="Scan or type" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Show at checkout
          </label>
          {!parts ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={openPrice} onChange={(e) => setOpenPrice(e.target.checked)} />
              Amount entered at checkout (e.g. termination fee)
            </label>
          ) : null}
          {(item?.kind ?? kind) === "membership" ? (
            <PackageEditor
              parts={parts}
              setParts={setParts}
              categories={categories}
              defaultCategoryId={categoryId}
              startTotalCents={Math.round(Number(price || 0) * 100)}
              autopayCount={autopayCount}
              setAutopayCount={setAutopayCount}
              autoRenews={autoRenews}
              setAutoRenews={setAutoRenews}
            />
          ) : null}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {taxed ? "Taxed at checkout." : "Not taxed."} Changes here stay in SynqIQ; Mindbody is never changed.
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={busy || !name.trim()} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
            {item ? (
              confirmDelete ? (
                <span className="ml-auto flex items-center gap-2 text-sm">
                  Delete {item.name}?
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const result = await act({ action: "itemDelete", id: item.id });
                      setBusy(false);
                      if (result.error) return setError(result.error);
                      router.refresh();
                      onClose();
                    }}
                  >
                    Yes, delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete item
                </Button>
              )
            ) : null}
            {error ? <span className="text-sm text-destructive">{error}</span> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Categories({ categories, items, taxPercent }: { categories: CatalogCategory[]; items: CatalogItem[]; taxPercent: number }) {
  const router = useRouter();
  const [tax, setTax] = useState(String(taxPercent));
  const [taxMessage, setTaxMessage] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sales tax rate</CardTitle>
          <CardDescription>Applied to taxed items at checkout.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input className="h-9 w-24" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          <span className="text-sm">%</span>
          <Button
            size="sm"
            onClick={async () => {
              const result = await act({ action: "taxRate", percent: Number(tax) });
              setTaxMessage(result.error ?? "Saved.");
              router.refresh();
            }}
          >
            Save
          </Button>
          {taxMessage ? <span className="text-sm text-muted-foreground">{taxMessage}</span> : null}
        </CardContent>
      </Card>
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Revenue categories</CardTitle>
          <CardDescription>
            Every item belongs to one. The category decides whether its items are taxed (an item can override) and which account its revenue
            posts to in your chart of accounts.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Taxed</TableHead>
              <TableHead>Account code</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                count={items.filter((item) => item.active && item.categoryId === category.id).length}
              />
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CategoryRow({ category, count }: { category: CatalogCategory; count: number }) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [taxable, setTaxable] = useState(category.taxable);
  const [gl, setGl] = useState(category.glAccount);
  const [state, setState] = useState<string | null>(null);
  const dirty = name !== category.name || taxable !== category.taxable || gl !== category.glAccount;
  return (
    <TableRow>
      <TableCell>
        <Input className="h-8 w-52" value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
          {taxable ? "Taxed" : "Not taxed"}
        </label>
      </TableCell>
      <TableCell>
        <Input className="h-8 w-32" placeholder="e.g. 4010" value={gl} onChange={(e) => setGl(e.target.value)} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{count}</TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={async () => {
            const result = await act({ action: "category", id: category.id, name, taxable, glAccount: gl, active: category.active });
            setState(result.error ?? "Saved");
            router.refresh();
          }}
        >
          Save
        </Button>
        {state ? <span className="block text-xs text-muted-foreground">{state}</span> : null}
      </TableCell>
    </TableRow>
  );
}

type PartDraft = { label: string; revenueCategoryId: string; amount: string; recurring: boolean };

// A membership package's price breakdown: what the first payment is made of
// (each part in its own revenue category) and which parts repeat monthly.
function PackageEditor({
  parts,
  setParts,
  categories,
  defaultCategoryId,
  startTotalCents,
  autopayCount,
  setAutopayCount,
  autoRenews,
  setAutoRenews,
}: {
  parts: PartDraft[] | null;
  setParts: (parts: PartDraft[] | null) => void;
  categories: CatalogCategory[];
  defaultCategoryId: string;
  startTotalCents: number;
  autopayCount: string;
  setAutopayCount: (value: string) => void;
  autoRenews: boolean;
  setAutoRenews: (value: boolean) => void;
}) {
  const registration = categories.find((c) => c.key === "registration_fee");
  const dues = categories.find((c) => c.key === "membership_dues");
  if (!parts) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm sm:col-span-2">
        <p className="text-muted-foreground">
          Sold as one amount. Make it a package to split the first payment (e.g. registration fee + first month&apos;s dues) and set the
          monthly payments.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() =>
            setParts([
              { label: "Registration fee", revenueCategoryId: registration?.id ?? defaultCategoryId, amount: "0.00", recurring: false },
              {
                label: "Monthly dues",
                revenueCategoryId: dues?.id ?? defaultCategoryId,
                amount: (startTotalCents / 100).toFixed(2),
                recurring: true,
              },
            ])
          }
        >
          Make it a package
        </Button>
      </div>
    );
  }
  const update = (index: number, change: Partial<PartDraft>) =>
    setParts(parts.map((part, i) => (i === index ? { ...part, ...change } : part)));
  const monthly = parts.filter((part) => part.recurring).reduce((sum, part) => sum + Math.round(Number(part.amount || 0) * 100), 0);
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm sm:col-span-2">
      <p className="font-medium">Package price breakdown</p>
      <p className="text-xs text-muted-foreground">
        Each part posts to its own revenue category. Parts marked &quot;Monthly&quot; are charged again every month; the rest only at the
        sale.
      </p>
      {parts.map((part, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-40" value={part.label} onChange={(e) => update(index, { label: e.target.value })} />
          <select
            aria-label="Revenue category"
            className={selectClass}
            value={part.revenueCategoryId}
            onChange={(e) => update(index, { revenueCategoryId: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.taxable ? " (taxed)" : ""}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1">
            $
            <Input
              className="h-8 w-24"
              inputMode="decimal"
              value={part.amount}
              onChange={(e) => update(index, { amount: e.target.value })}
            />
          </span>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={part.recurring} onChange={(e) => update(index, { recurring: e.target.checked })} />
            Monthly
          </label>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Remove part"
            onClick={() => setParts(parts.length === 1 ? null : parts.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setParts([...parts, { label: "", revenueCategoryId: defaultCategoryId, amount: "0.00", recurring: false }])}
      >
        <Plus /> Add a part
      </Button>
      <div className="flex flex-wrap items-center gap-3 border-t pt-2">
        <label className="flex items-center gap-1">
          Monthly payments after the first
          <Input
            className="h-8 w-16"
            inputMode="numeric"
            placeholder="∞"
            value={autopayCount}
            onChange={(e) => setAutopayCount(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={autoRenews} onChange={(e) => setAutoRenews(e.target.checked)} />
          Then continues month to month
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Each month: ${(monthly / 100).toFixed(2)} before tax
        {autopayCount ? `, ${autopayCount} times${autoRenews ? ", then month to month" : ""}` : ", until cancelled"}. Leave the count blank
        for month to month.
      </p>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setParts(null)}>
        Sell as one amount instead
      </button>
    </div>
  );
}

// Inventory categories in order: each category followed by its sub-categories.
export function orderedInventoryCategories(list: InventoryCategory[]): (InventoryCategory & { label: string; depth: number })[] {
  const byOrder = (a: InventoryCategory, b: InventoryCategory) => a.sort - b.sort || a.name.localeCompare(b.name);
  return list
    .filter((c) => !c.parentId)
    .sort(byOrder)
    .flatMap((top) => [
      { ...top, label: top.name, depth: 0 },
      ...list
        .filter((c) => c.parentId === top.id)
        .sort(byOrder)
        .map((sub) => ({ ...sub, label: `${top.name} › ${sub.name}`, depth: 1 })),
    ]);
}

// Add, rename, reorder and delete the categories at one level (the top
// level, or the sub-categories inside one category).
function CategoryManager({ level, parent, onDone }: { level: InventoryCategory[]; parent: InventoryCategory | null; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sorted = [...level].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    const result = await act(body);
    setBusy(false);
    setError(result.error);
    router.refresh();
    return !result.error;
  }
  async function move(index: number, direction: -1 | 1) {
    const other = sorted[index + direction];
    if (!other) return;
    const reordered = [...sorted];
    reordered[index] = other;
    reordered[index + direction] = sorted[index];
    setBusy(true);
    for (const [i, c] of reordered.entries()) {
      if (c.sort !== i * 10) await act({ action: "inventoryCategory", id: c.id, name: c.name, parentId: c.parentId, sort: i * 10 });
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{parent ? `Sub-categories in ${parent.name}` : "Categories"}</CardTitle>
        <CardDescription>
          For organizing only. Tax and accounting come from each item&apos;s revenue category, set when you edit the item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map((c, index) => (
          <ManagedCategory
            key={c.id}
            category={c}
            busy={busy}
            first={index === 0}
            last={index === sorted.length - 1}
            onMove={(direction) => move(index, direction)}
            onSave={(newName) => run({ action: "inventoryCategory", id: c.id, name: newName, parentId: c.parentId, sort: c.sort })}
            onDelete={() => run({ action: "inventoryCategoryDelete", id: c.id })}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <Input
            className="h-8 w-52"
            placeholder={parent ? "New sub-category" : "New category"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !name.trim()}
            onClick={async () => {
              const ok = await run({
                action: "inventoryCategory",
                name,
                parentId: parent?.id ?? null,
                sort: (sorted.length ? Math.max(...sorted.map((c) => c.sort)) : -10) + 10,
              });
              if (ok) setName("");
            }}
          >
            <Plus /> Add
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
            Done
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function ManagedCategory({
  category,
  busy,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  category: InventoryCategory;
  busy: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input className="h-8 w-52" value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" variant="ghost" disabled={busy || !name.trim() || name === category.name} onClick={() => onSave(name)}>
        Save
      </Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label="Move up" disabled={busy || first} onClick={() => onMove(-1)}>
        <ArrowUp className="size-3" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label="Move down" disabled={busy || last} onClick={() => onMove(1)}>
        <ArrowDown className="size-3" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label="Delete" disabled={busy} onClick={onDelete}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}
