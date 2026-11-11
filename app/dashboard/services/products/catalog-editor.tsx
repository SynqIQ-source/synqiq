"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, RefreshCw, ScanBarcode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PromoCodes, type PromoRow } from "./promo-codes";

export type CatalogCategory = { id: string; key: string; name: string; taxable: boolean; glAccount: string; active: boolean };
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
  taxPercent,
  lastSync,
  promos,
}: {
  items: CatalogItem[];
  categories: CatalogCategory[];
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
      {tab === "items" ? <Items items={items} categories={categories} lastSync={lastSync} /> : null}
      {tab === "categories" ? <Categories categories={categories} items={items} taxPercent={taxPercent} /> : null}
      {tab === "promos" ? <PromoCodes promos={promos} categories={categories} /> : null}
    </div>
  );
}

function Items({ items, categories, lastSync }: { items: CatalogItem[]; categories: CatalogCategory[]; lastSync: string | null }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
          onClose={() => {
            setSelected(null);
            searchRef.current?.focus();
          }}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {shown.map((item) => {
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
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches.</p> : null}
    </div>
  );
}

function ItemEditor({ item, categories, onClose }: { item: CatalogItem | null; categories: CatalogCategory[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? (item.priceCents / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [taxable, setTaxable] = useState<CatalogItem["taxable"]>(item?.taxable ?? "category");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [kind, setKind] = useState<CatalogItem["kind"]>(item?.kind ?? "product");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? null);
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
      price,
      revenueCategoryId: categoryId || null,
      taxable,
      barcode,
      active,
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
            Price
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
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
            Revenue category
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
