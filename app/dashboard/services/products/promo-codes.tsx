"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CatalogCategory } from "./catalog-editor";

export type PromoRow = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  percent: number | null;
  amountCents: number | null;
  categoryIds: string[] | null;
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  uses: number;
  note: string | null;
};

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/pos/promos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
  return response.ok && result.success ? null : (result.error ?? "Couldn't save. Try again.");
}

// Promo codes staff type in at checkout (Club Admin creates them).
export function PromoCodes({ promos, categories }: { promos: PromoRow[]; categories: CatalogCategory[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [only, setOnly] = useState<string[]>([]);
  const [endsOn, setEndsOn] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New promo code</CardTitle>
          <CardDescription>
            Staff type the code at checkout. Leave the categories unticked for a code that works on everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label>
              Code
              <Input className="h-9 w-40" placeholder="e.g. NOFEE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <label>
              Discount
              <select
                className="block h-9 rounded-md border bg-background px-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as "percent" | "amount")}
              >
                <option value="percent">% off</option>
                <option value="amount">$ off</option>
              </select>
            </label>
            <label>
              {kind === "percent" ? "Percent" : "Dollars"}
              <Input className="h-9 w-24" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <label>
              Ends (optional)
              <Input type="date" className="h-9" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
            <label>
              Max uses (optional)
              <Input className="h-9 w-24" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            </label>
            <label className="flex-1">
              Note
              <Input className="h-9" placeholder="What it's for" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-muted-foreground">Only on:</span>
            {categories.map((category) => (
              <label key={category.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={only.includes(category.id)}
                  onChange={(e) => setOnly(e.target.checked ? [...only, category.id] : only.filter((id) => id !== category.id))}
                />
                {category.name}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!code.trim() || !value.trim()}
              onClick={async () => {
                setError(null);
                const problem = await post({
                  code,
                  kind,
                  percent: kind === "percent" ? value : null,
                  amount: kind === "amount" ? value : null,
                  categoryIds: only,
                  endsOn: endsOn || null,
                  maxUses: maxUses || null,
                  note,
                });
                if (problem) return setError(problem);
                setCode("");
                setValue("");
                setOnly([]);
                setEndsOn("");
                setMaxUses("");
                setNote("");
                router.refresh();
              }}
            >
              Create code
            </Button>
            {error ? <span className="text-sm text-destructive">{error}</span> : null}
          </div>
        </CardContent>
      </Card>
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Active codes</CardTitle>
        </CardHeader>
        {promos.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No promo codes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>On</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {promos.map((promo) => (
                <TableRow key={promo.id}>
                  <TableCell className="font-mono font-medium">
                    {promo.code}
                    {promo.note ? <span className="block font-sans text-xs text-muted-foreground">{promo.note}</span> : null}
                  </TableCell>
                  <TableCell>
                    {promo.kind === "percent" ? `${promo.percent}% off` : `$${((promo.amountCents ?? 0) / 100).toFixed(2)} off`}
                  </TableCell>
                  <TableCell className="text-sm">
                    {promo.categoryIds?.length ? promo.categoryIds.map((id) => name.get(id) ?? "?").join(", ") : "Everything"}
                  </TableCell>
                  <TableCell className="text-sm">{promo.endsOn ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {promo.uses}
                    {promo.maxUses ? ` / ${promo.maxUses}` : ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await post({ id: promo.id, deactivate: true });
                        router.refresh();
                      }}
                    >
                      Turn off
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
