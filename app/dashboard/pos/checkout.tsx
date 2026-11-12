"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, ScanBarcode, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { computeCart, type PromoInput } from "@/lib/pos/cart";
import { expandCartLines, monthlySchedule, scheduleTerms, type PricedPart } from "@/lib/pos/packages";

export type CheckoutCategory = { id: string; key: string; name: string; commissionable: boolean };
export type CheckoutItem = {
  id: string;
  kind: "product" | "service" | "membership";
  name: string;
  priceCents: number;
  categoryId: string;
  taxable: boolean;
  barcode: string | null;
  imageUrl: string | null;
  sessions: number | null;
  parts: PricedPart[] | null; // membership package: what the first payment is made of
  autopayCount: number | null;
  autoRenews: boolean;
  openPrice: boolean; // amount entered at checkout (e.g. termination fee)
  inventoryCategoryId: string | null;
};
export type PosCategory = { id: string; parentId: string | null; name: string; sort: number };
const UNSORTED = "__unsorted";
type Person = { id: string; name: string };
type Member = { id: string; name: string; status: string; plans: string[]; frozen: boolean };
type Credit = { staffId: string; share: number };
type Line = {
  key: string;
  itemId: string;
  quantity: number;
  discount: { kind: "percent" | "amount"; value: string } | null;
  credits: Credit[];
  none: boolean;
  price?: string; // open-price items: dollars typed at checkout
  months?: string; // termination fee helper: months left on the contract
  dues?: string; // ...and the monthly dues
};
type Receipt = {
  saleNumber: number;
  member: string;
  lines: { name: string; quantity: number; totalCents: number; discountCents: number; sub?: boolean }[];
  schedules: string[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  promo: string | null;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const selectClass = "h-8 rounded-md border bg-background px-1 text-xs";

export function Checkout({
  items,
  inventoryCategories,
  categories,
  taxRate,
  mayDiscount,
  people,
  me,
  freezeNotice,
}: {
  items: CheckoutItem[];
  inventoryCategories: PosCategory[];
  categories: CheckoutCategory[];
  taxRate: number;
  mayDiscount: boolean;
  people: Person[];
  me: Person;
  freezeNotice: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null); // inventory category being browsed
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<(PromoInput & { code: string }) | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const itemBy = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const categoryBy = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const q = search.trim().toLowerCase();
  // Same layout as Products & Inventory: category cards -> sub-category
  // cards -> items. Searching or scanning shows matches from everywhere.
  const invBy = new Map(inventoryCategories.map((c) => [c.id, c]));
  const placeOf = (item: CheckoutItem) =>
    item.inventoryCategoryId && invBy.has(item.inventoryCategoryId) ? item.inventoryCategoryId : UNSORTED;
  const itemsUnder = (id: string) =>
    items.filter((item) => placeOf(item) === id || (id !== UNSORTED && invBy.get(placeOf(item))?.parentId === id));
  const open = openId && openId !== UNSORTED ? (invBy.get(openId) ?? null) : null;
  const cards = q
    ? []
    : [
        ...inventoryCategories
          .filter((c) => c.parentId === (openId === UNSORTED ? "none" : openId))
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
        ...(!openId && items.some((item) => placeOf(item) === UNSORTED)
          ? [{ id: UNSORTED, parentId: null, name: "Other items", sort: 0 }]
          : []),
      ].filter((c) => itemsUnder(c.id).length > 0);
  const shown = q
    ? items.filter((item) => item.name.toLowerCase().includes(q))
    : openId
      ? items.filter((item) => placeOf(item) === openId)
      : [];

  const expanded = expandCartLines(
    lines.map((line) => {
      const item = itemBy.get(line.itemId)!;
      const value = Number(line.discount?.value ?? 0);
      return {
        key: line.key,
        quantity: line.quantity,
        item: item.openPrice ? { ...item, priceCents: Math.round(Number(line.price || 0) * 100) } : item,
        manualDiscount:
          line.discount && value > 0
            ? { kind: line.discount.kind, value: line.discount.kind === "amount" ? Math.round(value * 100) : value }
            : null,
      };
    }),
  );
  const cart = computeCart(expanded, taxRate, promo);
  // Per cart line (a package adds up its parts).
  const lineTotals = (key: string) => {
    const parts = cart.lines.filter((_, index) => expanded[index].parentKey === key);
    return {
      netCents: parts.reduce((sum, line) => sum + line.netCents, 0),
      promoDiscountCents: parts.reduce((sum, line) => sum + line.promoDiscountCents, 0),
      discountCents: parts.reduce((sum, line) => sum + line.manualDiscountCents + line.promoDiscountCents, 0),
      parts: parts.map((line, i) => ({ line, part: expanded[cart.lines.indexOf(line)].part, i })),
    };
  };
  const categoryKeysOf = (item: CheckoutItem) =>
    item.parts ? item.parts.map((part) => categoryBy.get(part.revenueCategoryId)?.key) : [categoryBy.get(item.categoryId)?.key];
  const isCommissionable = (item: CheckoutItem) =>
    item.parts
      ? item.parts.some((part) => categoryBy.get(part.revenueCategoryId)?.commissionable)
      : Boolean(categoryBy.get(item.categoryId)?.commissionable);
  const sellsMembership = lines.some((line) => categoryKeysOf(itemBy.get(line.itemId)!).includes("membership_dues"));
  const packageNeedsMember = !member && lines.some((line) => itemBy.get(line.itemId)?.parts);
  const missingAmount = lines.some((line) => itemBy.get(line.itemId)?.openPrice && !(Number(line.price) >= 0 && line.price?.trim()));
  const today = new Date().toLocaleDateString("en-CA");

  function add(item: CheckoutItem) {
    setReceipt(null);
    setLines((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing && item.parts) return current; // packages: one at a time
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      return [
        ...current,
        {
          key: `${item.id}-${Date.now()}`,
          itemId: item.id,
          quantity: 1,
          discount: null,
          credits: [],
          none: false,
          ...(item.openPrice ? { price: "", months: "", dues: "219.00" } : {}),
        },
      ];
    });
  }
  const update = (key: string, change: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  async function applyPromo() {
    setPromoError(null);
    const response = await fetch("/api/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "promo", code: promoCode }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      promo?: PromoInput & { code: string };
    };
    if (!response.ok || !result.promo) {
      setPromo(null);
      return setPromoError(result.error ?? "That code doesn't work.");
    }
    setPromo(result.promo);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sale",
        clientId: member?.id ?? null,
        clientName: member?.name ?? null,
        promoCode: promo?.code ?? null,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          priceCents: itemBy.get(line.itemId)?.openPrice ? Math.round(Number(line.price || 0) * 100) : null,
          discount:
            line.discount && Number(line.discount.value) > 0
              ? {
                  kind: line.discount.kind,
                  value: line.discount.kind === "amount" ? Math.round(Number(line.discount.value) * 100) : Number(line.discount.value),
                }
              : null,
          credits: line.none ? [] : line.credits.filter((credit) => credit.staffId),
          none: line.none,
        })),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; saleNumber?: number };
    setSaving(false);
    if (!response.ok || !result.success) return setError(result.error ?? "Couldn't save. Try again.");
    setReceipt({
      saleNumber: result.saleNumber ?? 0,
      member: member?.name ?? "Walk-in",
      lines: lines.flatMap((line) => {
        const item = itemBy.get(line.itemId)!;
        const totals = lineTotals(line.key);
        return [
          { name: item.name, quantity: line.quantity, totalCents: totals.netCents, discountCents: totals.discountCents },
          ...(item.parts
            ? totals.parts.map(({ line: part, part: info }) => ({
                name: info?.label ?? "",
                quantity: 1,
                totalCents: part.netCents,
                discountCents: 0,
                sub: true,
              }))
            : []),
        ];
      }),
      schedules: lines.flatMap((line) => {
        const item = itemBy.get(line.itemId)!;
        const schedule = item.parts ? monthlySchedule(item.parts, taxRate, today) : null;
        return schedule
          ? [
              `${item.name}: ${money(schedule.totalCents)}/month incl. tax from ${schedule.firstBillDate}, ${scheduleTerms(item.autopayCount, item.autoRenews)}`,
            ]
          : [];
      }),
      subtotalCents: cart.subtotalCents,
      discountCents: cart.discountCents,
      taxCents: cart.taxCents,
      totalCents: cart.totalCents,
      promo: promo?.code ?? null,
    });
    setLines([]);
    setMember(null);
    setPromo(null);
    setPromoCode("");
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
        <span className="font-medium">Practice mode.</span> Sales are saved so you can check the screen, tax and commission. No card is
        charged and nothing changes in Mindbody.
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <ScanBarcode className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                autoFocus
                className="h-9 w-64 pl-8"
                placeholder="Search or scan"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const code = search.trim();
                  const hit = items.find((item) => item.barcode && item.barcode === code) ?? (shown.length === 1 ? shown[0] : undefined);
                  if (hit) {
                    add(hit);
                    setSearch("");
                  }
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {openId || q ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (q) return setSearch("");
                  setOpenId(open?.parentId ?? null);
                }}
              >
                <ChevronLeft /> Back
              </Button>
            ) : null}
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
                <span className="font-medium">{open?.name ?? "Other items"}</span>
              </>
            ) : null}
            {q ? <span className="text-muted-foreground">· search results</span> : null}
          </div>
          {cards.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {cards.map((c) => {
                const cover = itemsUnder(c.id).find((item) => item.imageUrl)?.imageUrl ?? null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-sm active:scale-[0.98]"
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
                      <span className="text-xs text-muted-foreground tabular-nums">{itemsUnder(c.id).length}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {shown.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {shown.map((item) => {
                const schedule = item.parts ? monthlySchedule(item.parts, taxRate, today) : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => add(item)}
                    className="overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-sm active:scale-[0.98]"
                  >
                    <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <span className="text-2xl font-semibold text-muted-foreground/60">{item.name.trim().charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-2 text-xs leading-tight font-medium">{item.name}</p>
                      <p className="text-sm tabular-nums">
                        {item.openPrice ? (
                          <span className="text-xs text-muted-foreground">Amount at checkout</span>
                        ) : (
                          money(item.priceCents)
                        )}
                        {item.parts ? <span className="text-xs text-muted-foreground"> today</span> : null}
                      </p>
                      {schedule ? (
                        <p className="text-xs text-muted-foreground tabular-nums">then {money(schedule.subtotalCents)}/mo + tax</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {(q || openId) && shown.length === 0 && cards.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing matches.</p>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          {receipt ? (
            <ReceiptCard receipt={receipt} onNew={() => setReceipt(null)} />
          ) : (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Cart</CardTitle>
                <MemberPicker member={member} onChange={setMember} />
              </CardHeader>
              <CardContent className="space-y-3">
                {member?.frozen && sellsMembership ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    {freezeNotice}
                  </p>
                ) : null}
                {lines.length === 0 ? <p className="text-sm text-muted-foreground">Tap an item or scan a barcode to add it.</p> : null}
                {lines.map((line) => {
                  const item = itemBy.get(line.itemId)!;
                  const computed = lineTotals(line.key);
                  const commissionable = isCommissionable(item);
                  const schedule = item.parts ? monthlySchedule(item.parts, taxRate, today) : null;
                  return (
                    <div key={line.key} className="space-y-1 border-b pb-2 last:border-b-0">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <p className="text-sm leading-tight font-medium">{item.name}</p>
                          {item.parts || item.openPrice ? null : (
                            <p className="text-xs text-muted-foreground">
                              {money(item.priceCents)} each{item.taxable ? " · taxed" : ""}
                            </p>
                          )}
                          {item.openPrice ? (
                            <div className="mt-1 space-y-1 text-xs">
                              <label className="flex items-center gap-1">
                                Amount $
                                <Input
                                  aria-label="Amount"
                                  className="h-7 w-24 text-xs"
                                  inputMode="decimal"
                                  value={line.price ?? ""}
                                  onChange={(e) => update(line.key, { price: e.target.value })}
                                />
                              </label>
                              <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
                                Half the dues left:
                                <Input
                                  aria-label="Months left"
                                  className="h-7 w-12 text-xs"
                                  inputMode="numeric"
                                  placeholder="mo"
                                  value={line.months ?? ""}
                                  onChange={(e) => update(line.key, { months: e.target.value.replace(/[^0-9]/g, "") })}
                                />
                                months × $
                                <Input
                                  aria-label="Monthly dues"
                                  className="h-7 w-20 text-xs"
                                  inputMode="decimal"
                                  value={line.dues ?? ""}
                                  onChange={(e) => update(line.key, { dues: e.target.value })}
                                />
                                ÷ 2
                                <button
                                  type="button"
                                  className="text-primary underline"
                                  disabled={!Number(line.months) || !Number(line.dues)}
                                  onClick={() =>
                                    update(line.key, {
                                      price: (Math.round((Number(line.months) * Math.round(Number(line.dues) * 100)) / 2) / 100).toFixed(2),
                                    })
                                  }
                                >
                                  Use{" "}
                                  {Number(line.months) && Number(line.dues)
                                    ? money(Math.round((Number(line.months) * Math.round(Number(line.dues) * 100)) / 2))
                                    : ""}
                                </button>
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className={`flex items-center gap-1 ${item.parts || item.openPrice ? "hidden" : ""}`}>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-7"
                            onClick={() => update(line.key, { quantity: Math.max(1, line.quantity - 1) })}
                          >
                            <Minus className="size-3" />
                          </Button>
                          <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-7"
                            onClick={() => update(line.key, { quantity: line.quantity + 1 })}
                          >
                            <Plus className="size-3" />
                          </Button>
                        </div>
                        <span className="w-16 text-right text-sm tabular-nums">{money(computed.netCents)}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                      {item.parts ? (
                        <div className="space-y-0.5 rounded-md bg-muted/50 px-2 py-1 text-xs">
                          {computed.parts.map(({ line: part, part: info, i }) => (
                            <div key={i} className="flex justify-between">
                              <span>
                                {info?.label}
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {categoryBy.get(info?.revenueCategoryId ?? "")?.name}
                                  {part.taxable ? " · taxed" : ""}
                                </span>
                              </span>
                              <span className="tabular-nums">{money(part.netCents)}</span>
                            </div>
                          ))}
                          {schedule ? (
                            <p className="border-t pt-0.5 text-muted-foreground">
                              Then {money(schedule.subtotalCents)} + tax = <span className="font-medium">{money(schedule.totalCents)}</span>{" "}
                              a month from {schedule.firstBillDate}, {scheduleTerms(item.autopayCount, item.autoRenews)}.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1">
                        {mayDiscount ? (
                          line.discount ? (
                            <span className="flex items-center gap-1">
                              <select
                                aria-label="Discount type"
                                className={selectClass}
                                value={line.discount.kind}
                                onChange={(e) =>
                                  update(line.key, {
                                    discount: { kind: e.target.value as "percent" | "amount", value: line.discount!.value },
                                  })
                                }
                              >
                                <option value="percent">% off</option>
                                <option value="amount">$ off</option>
                              </select>
                              <Input
                                aria-label="Discount"
                                className="h-8 w-16 text-xs"
                                inputMode="decimal"
                                value={line.discount.value}
                                onChange={(e) => update(line.key, { discount: { kind: line.discount!.kind, value: e.target.value } })}
                              />
                              <button type="button" aria-label="Remove discount" onClick={() => update(line.key, { discount: null })}>
                                <X className="size-3" />
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs text-primary underline"
                              onClick={() => update(line.key, { discount: { kind: "percent", value: "" } })}
                            >
                              Discount
                            </button>
                          )
                        ) : null}
                        {computed.promoDiscountCents ? (
                          <Badge variant="secondary">Promo −{money(computed.promoDiscountCents)}</Badge>
                        ) : null}
                      </div>
                      {commissionable ? (
                        <CommissionPicker line={line} people={people} me={me} onChange={(change) => update(line.key, change)} />
                      ) : null}
                    </div>
                  );
                })}

                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Promo code"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  />
                  {promo ? (
                    <Button size="sm" variant="ghost" onClick={() => setPromo(null)}>
                      Remove
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!promoCode.trim()} onClick={applyPromo}>
                      Apply
                    </Button>
                  )}
                </div>
                {promo ? <p className="text-xs text-emerald-700 dark:text-emerald-400">Code {promo.code} applied.</p> : null}
                {promoError ? <p className="text-xs text-destructive">{promoError}</p> : null}

                <div className="space-y-1 border-t pt-2 text-sm">
                  <Row label="Subtotal" value={money(cart.subtotalCents)} />
                  {cart.discountCents ? <Row label="Discounts" value={`−${money(cart.discountCents)}`} /> : null}
                  <Row label={`Tax (${(taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%)`} value={money(cart.taxCents)} />
                  <Row label="Total" value={money(cart.totalCents)} strong />
                </div>
                {missingAmount ? <p className="text-xs text-amber-700 dark:text-amber-400">Enter the amount for the fee.</p> : null}
                {packageNeedsMember ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">Pick the member for the membership.</p>
                ) : null}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <Button className="w-full" disabled={saving || lines.length === 0 || packageNeedsMember || missingAmount} onClick={save}>
                  {saving ? "Saving…" : "Save practice sale"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">Card payment connects here once Stripe is set up.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-base font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CommissionPicker({
  line,
  people,
  me,
  onChange,
}: {
  line: Line;
  people: Person[];
  me: Person;
  onChange: (change: Partial<Line>) => void;
}) {
  const value = line.none ? "none" : (line.credits[0]?.staffId ?? "");
  const missing = !line.none && line.credits.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className={missing ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>Commission:</span>
      <select
        aria-label="Commission"
        className={selectClass}
        value={value}
        onChange={(e) => {
          if (e.target.value === "none") return onChange({ none: true, credits: [] });
          if (!e.target.value) return onChange({ none: false, credits: [] });
          const second = line.credits[1];
          onChange({
            none: false,
            credits: second ? [{ staffId: e.target.value, share: 50 }, second] : [{ staffId: e.target.value, share: 100 }],
          });
        }}
      >
        <option value="">Choose…</option>
        <option value="none">None</option>
        <option value={me.id}>Me ({me.name})</option>
        {people
          .filter((person) => person.id !== me.id)
          .map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
      </select>
      {!line.none && line.credits.length === 1 ? (
        <button
          type="button"
          className="text-primary underline"
          onClick={() =>
            onChange({
              credits: [
                { ...line.credits[0], share: 50 },
                { staffId: "", share: 50 },
              ],
            })
          }
        >
          Split 50/50
        </button>
      ) : null}
      {!line.none && line.credits.length === 2 ? (
        <>
          <span>and</span>
          <select
            aria-label="Split with"
            className={selectClass}
            value={line.credits[1].staffId}
            onChange={(e) => onChange({ credits: [line.credits[0], { staffId: e.target.value, share: 50 }] })}
          >
            <option value="">Choose…</option>
            {people
              .filter((person) => person.id !== line.credits[0].staffId)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </select>
          <button type="button" aria-label="Remove split" onClick={() => onChange({ credits: [{ ...line.credits[0], share: 100 }] })}>
            <X className="size-3" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function MemberPicker({ member, onChange }: { member: Member | null; onChange: (member: Member | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/pos/members?q=${encodeURIComponent(q)}`);
      const result = (await response.json().catch(() => ({}))) as { members?: Member[] };
      setResults(result.members ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  if (member) {
    return (
      <div className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
        <span>
          <span className="font-medium">{member.name}</span>
          <span className="block text-xs text-muted-foreground">
            {member.frozen ? "On freeze" : member.plans.join(", ") || member.status}
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        className="h-8 text-sm"
        placeholder="Member name (or leave blank for walk-in)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length ? (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="block w-full px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                onChange(result);
                setQuery("");
                setResults([]);
              }}
            >
              {result.name} {result.frozen ? <Badge variant="secondary">On freeze</Badge> : null}
              <span className="block text-xs text-muted-foreground">{result.plans.join(", ") || result.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReceiptCard({ receipt, onNew }: { receipt: Receipt; onNew: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Practice sale #{receipt.saleNumber}</CardTitle>
        <p className="text-sm text-muted-foreground">{receipt.member} · not charged</p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {receipt.lines.map((line, index) => (
          <div key={index} className={`flex justify-between ${line.sub ? "pl-4 text-xs text-muted-foreground" : ""}`}>
            <span>
              {line.sub ? line.name : `${line.quantity} × ${line.name}`}
              {line.discountCents ? (
                <span className="block text-xs text-muted-foreground">−{money(line.discountCents)} discount</span>
              ) : null}
            </span>
            <span className="tabular-nums">{money(line.totalCents)}</span>
          </div>
        ))}
        <div className="space-y-1 border-t pt-2">
          <Row label="Subtotal" value={money(receipt.subtotalCents)} />
          {receipt.discountCents ? (
            <Row label={`Discounts${receipt.promo ? ` (incl. ${receipt.promo})` : ""}`} value={`−${money(receipt.discountCents)}`} />
          ) : null}
          <Row label="Tax" value={money(receipt.taxCents)} />
          <Row label="Total" value={money(receipt.totalCents)} strong />
        </div>
        {receipt.schedules.map((text) => (
          <p key={text} className="text-xs text-muted-foreground">
            {text}
          </p>
        ))}
        <div className="flex gap-2 pt-2">
          <Button className="flex-1" onClick={onNew}>
            New sale
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
