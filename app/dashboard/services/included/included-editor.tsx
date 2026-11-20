"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = { id: string; name: string; active: boolean };
type Category = { id: string; name: string; type: string | null; needs: string | null };
export type PricingOptionRow = {
  key: string;
  productId: string | null;
  posItemId: string | null;
  name: string;
  group: string;
  holders: number;
  ticked: string[];
};

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/included", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Didn't save.");
}

export function IncludedEditor({
  items,
  membershipDefaults,
  categories,
  options,
}: {
  items: Item[];
  membershipDefaults: string[];
  categories: Category[];
  options: PricingOptionRow[];
}) {
  const router = useRouter();
  const [newItem, setNewItem] = useState("");
  const [defaults, setDefaults] = useState<string[]>(membershipDefaults);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const active = items.filter((item) => item.active);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await work() });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Didn't save." });
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string | null) => items.find((item) => item.id === id)?.name ?? "—";
  const shown = showAll ? options : options.filter((option) => option.holders > 0 || option.ticked.length);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What memberships and passes can include</CardTitle>
          <CardDescription>Name the things your memberships include, e.g. gym access, group classes, towels, recovery.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <Badge key={item.id} variant={item.active ? "secondary" : "outline"} className="gap-2">
                {item.name}
                <button
                  type="button"
                  className="text-xs underline"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await post({ action: "update_item", id: item.id, active: !item.active });
                      return item.active ? `${item.name} hidden.` : `${item.name} back in use.`;
                    })
                  }
                >
                  {item.active ? "hide" : "use"}
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              className="max-w-xs"
              placeholder="Add an item (e.g. Childcare)"
              value={newItem}
              onChange={(event) => setNewItem(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !newItem.trim()}
              onClick={() =>
                run(async () => {
                  await post({ action: "add_item", name: newItem });
                  setNewItem("");
                  return "Added.";
                })
              }
            >
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Every membership includes</CardTitle>
          <CardDescription>
            Unless a membership below is ticked differently. Change a single membership (e.g. a Premium tier with towels and recovery) in
            the list further down.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {active.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={defaults.includes(item.id)}
                  onChange={(event) => setDefaults(event.target.checked ? [...defaults, item.id] : defaults.filter((id) => id !== item.id))}
                />
                {item.name}
              </label>
            ))}
          </div>
          <Button
            disabled={busy || [...defaults].sort().join() === [...membershipDefaults].sort().join()}
            onClick={() =>
              run(async () => {
                await post({ action: "membership_defaults", itemIds: defaults });
                return "Saved.";
              })
            }
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each class category needs</CardTitle>
          <CardDescription>
            Every class follows its category. A member can book if something on their account includes this.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {categories.map((category) => (
            <div key={category.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-2 text-sm">
              <span>
                <span className="font-medium">{category.name}</span>
                {category.type ? <span className="ml-2 text-xs text-muted-foreground">{category.type}</span> : null}
              </span>
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={category.needs ?? ""}
                disabled={busy}
                onChange={(event) =>
                  run(async () => {
                    await post({ action: "category_needs", departmentId: category.id, itemId: event.target.value });
                    return `${category.name} now needs ${nameOf(event.target.value)}.`;
                  })
                }
              >
                {!category.needs ? <option value="">Pick…</option> : null}
                {active.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Each membership, pass and pack</CardTitle>
          <CardDescription>
            Leave a row unticked to use the default: memberships get &quot;Every membership includes&quot;; packs cover their own category.
            Tick to set exactly what it includes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Pricing option</th>
                  <th className="px-2 py-2 text-right font-medium">Members</th>
                  {active.map((item) => (
                    <th key={item.id} className="px-2 py-2 text-center text-xs font-medium">
                      {item.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((option) => (
                  <OptionRow key={option.key} option={option} items={active} busy={busy} run={run} />
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="px-4 pb-4 text-sm underline" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show only ones members hold" : "Show everything sold in SynqIQ too"}
          </button>
        </CardContent>
      </Card>
      {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </div>
  );
}

function OptionRow({
  option,
  items,
  busy,
  run,
}: {
  option: PricingOptionRow;
  items: Item[];
  busy: boolean;
  run: (work: () => Promise<string>) => Promise<void>;
}) {
  const [ticked, setTicked] = useState<string[]>(option.ticked);
  const dirty = [...ticked].sort().join() !== [...option.ticked].sort().join();
  return (
    <tr>
      <td className="px-4 py-2">
        <span className="font-medium">{option.name}</span>
        <span className="block text-xs text-muted-foreground">
          {option.group}
          {option.ticked.length ? "" : " · using the default"}
        </span>
        {dirty ? (
          <button
            type="button"
            className="text-xs font-medium underline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await post({ action: "grants", productId: option.productId, posItemId: option.posItemId, itemIds: ticked });
                return `${option.name} saved.`;
              })
            }
          >
            Save
          </button>
        ) : null}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{option.holders || ""}</td>
      {items.map((item) => (
        <td key={item.id} className="px-2 py-2 text-center">
          <input
            type="checkbox"
            aria-label={`${option.name} includes ${item.name}`}
            checked={ticked.includes(item.id)}
            onChange={(event) => setTicked(event.target.checked ? [...ticked, item.id] : ticked.filter((id) => id !== item.id))}
          />
        </td>
      ))}
    </tr>
  );
}
