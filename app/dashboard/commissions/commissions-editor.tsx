"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CATEGORY_LABELS,
  COMMISSION_CATEGORIES,
  COMMISSION_CONDITIONS,
  CONDITION_LABELS,
  describeRule,
  type CommissionCategory,
  type CommissionPlan,
} from "@/lib/payroll/commission";

export type PersonRow = { id: string; name: string; role: string; trainer: boolean; planId: string; enabled: string; effective: string };
export type ProductRow = { productId: number; name: string; category: CommissionCategory };
export type CommissionLineRow = {
  id: string;
  staffName: string;
  kind: "earn" | "clawback";
  saleAt: string;
  description: string;
  condition: string;
  baseCents: number;
  percent: number | null;
  flatCents: number | null;
  amountCents: number;
};
export type SaleRow = {
  detailId: number;
  saleAt: string;
  description: string;
  category: CommissionCategory;
  rungUpBy: string | null;
  preTaxCents: number;
  credits: { staffId: string; name: string; share: number; source: string }[];
  none: boolean;
};

const ROLES = [
  { value: "sales", label: "Sales" },
  { value: "sales_lead", label: "Sales Lead" },
  { value: "staff", label: "Staff" },
  { value: "admin", label: "Club Admin" },
];
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

async function act(body: Record<string, unknown>): Promise<{ error: string | null; data?: Record<string, unknown> }> {
  try {
    const response = await fetch("/api/payroll/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string } & Record<string, unknown>;
    return response.ok && result.success ? { error: null, data: result } : { error: result.error ?? "Couldn't save. Try again." };
  } catch {
    return { error: "Couldn't reach SynqIQ. Try again." };
  }
}

export function CommissionsEditor(props: {
  from: string;
  to: string;
  timezone: string;
  ptMonths: number;
  plans: CommissionPlan[];
  people: PersonRow[];
  products: ProductRow[];
  lines: CommissionLineRow[];
  sales: SaleRow[];
  pickable: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<"earned" | "sales" | "plans" | "people" | "products">("earned");
  const uncredited = props.sales.filter((row) => !row.none && row.credits.length === 0).length;
  const tabs = [
    { key: "earned", label: "Earned" },
    { key: "sales", label: `Sales${uncredited ? ` (${uncredited} not credited)` : ""}` },
    { key: "plans", label: "Plans" },
    { key: "people", label: "People" },
    { key: "products", label: "Products" },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === item.key ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "earned" || tab === "sales" ? <RangeBar from={props.from} to={props.to} /> : null}
      {tab === "earned" ? <Earned lines={props.lines} timezone={props.timezone} /> : null}
      {tab === "sales" ? <Sales rows={props.sales} pickable={props.pickable} timezone={props.timezone} /> : null}
      {tab === "plans" ? <Plans plans={props.plans} ptMonths={props.ptMonths} /> : null}
      {tab === "people" ? <People people={props.people} plans={props.plans} /> : null}
      {tab === "products" ? <Products products={props.products} /> : null}
    </div>
  );
}

function RangeBar({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          From
          <Input type="date" name="from" defaultValue={from} className="h-9" />
        </label>
        <label className="text-sm">
          To
          <Input type="date" name="to" defaultValue={to} className="h-9" />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Show
        </Button>
      </form>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const result = await act({ action: "recalc", from, to });
          setBusy(false);
          setMessage(result.error ?? `Checked ${result.data?.saleLines ?? 0} sale lines; ${result.data?.earned ?? 0} pay commission.`);
          router.refresh();
        }}
      >
        {busy ? "Figuring…" : "Figure commission for these dates"}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  );
}

function Earned({ lines, timezone }: { lines: CommissionLineRow[]; timezone: string }) {
  const totals = new Map<string, number>();
  lines.forEach((line) => totals.set(line.staffName, (totals.get(line.staffName) ?? 0) + line.amountCents));
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Totals</CardTitle>
          <CardDescription>Commission earned in these dates, less any returns.</CardDescription>
        </CardHeader>
        {totals.size === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No commission in these dates.</p>
        ) : (
          <Table>
            <TableBody>
              {[...totals.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, cents]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(cents)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {lines.length ? (
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Every line</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sold</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Pre-tax</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="text-sm">{day(line.saleAt)}</TableCell>
                    <TableCell>{line.staffName}</TableCell>
                    <TableCell className="text-sm">
                      {line.description}
                      {line.kind === "clawback" ? (
                        <Badge variant="destructive" className="ml-1">
                          Returned
                        </Badge>
                      ) : null}
                      {line.condition === "handoff" ? (
                        <Badge variant="secondary" className="ml-1">
                          Handoff
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(line.baseCents)}</TableCell>
                    <TableCell className="text-sm">{describeRule(line)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(line.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Sales({ rows, pickable, timezone }: { rows: SaleRow[]; pickable: { id: string; name: string }[]; timezone: string }) {
  const [filter, setFilter] = useState<"all" | "uncredited">("all");
  const shown = rows.filter((row) => (filter === "uncredited" ? !row.none && row.credits.length === 0 : true));
  return (
    <div className="space-y-4">
      <ImportReport />
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Who earns on each sale</CardTitle>
          <CardDescription>
            Commission goes only to the people credited on a sale line, on their share (split a sale between two people with 50% each).
            Choose None when nobody should earn on it. Whoever rang up the sale doesn&apos;t earn unless they&apos;re credited.
          </CardDescription>
          <select
            aria-label="Show"
            className={`${selectClass} mt-2 w-60`}
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "uncredited")}
          >
            <option value="all">All commissionable sales</option>
            <option value="uncredited">Not credited to anyone yet</option>
          </select>
        </CardHeader>
        {shown.length === 0 ? (
          <p className="border-t px-6 py-4 text-sm text-muted-foreground">Nothing to show for these dates.</p>
        ) : (
          <div className="divide-y border-t">
            {shown.map((row) => (
              <SaleLine key={row.detailId} row={row} pickable={pickable} timezone={timezone} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ImportReport() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: string | null; data?: Record<string, unknown> } | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Mindbody&apos;s commission report</CardTitle>
        <CardDescription>
          While Mindbody is still the checkout: in Mindbody, open Reports &gt; Commission, pick View: All staff members - Detail, tick
          Include inactive staff and Show split commission detail, set the pay period and Generate. Then export it to Excel and choose the
          file here, or select the whole report on the page, copy, and paste it below. Each line is matched to the synced sale and the
          people Mindbody paid are credited (two reps on one line split it 50/50).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <input
          type="file"
          accept=".xls,.xlsx,.htm,.html,.csv,.txt"
          className="text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await file.text());
          }}
        />
        <textarea
          className="min-h-24 w-full rounded-md border bg-background p-2 font-mono text-xs"
          placeholder="…or paste the report here"
          value={text.length > 20000 ? `${text.slice(0, 20000)}\n… (${text.length.toLocaleString()} characters loaded)` : text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              const response = await act({ action: "import", text });
              setBusy(false);
              setResult(response);
              if (!response.error) router.refresh();
            }}
          >
            {busy ? "Importing…" : "Import and credit sales"}
          </Button>
          {result?.error ? <span className="text-sm text-destructive">{result.error}</span> : null}
          {result?.data ? (
            <span className="text-sm text-muted-foreground">
              {String(result.data.matched)} of {String(Number(result.data.lines) - Number(result.data.skipped))} report lines matched;{" "}
              {String(result.data.credited)} sale lines credited.
            </span>
          ) : null}
        </div>
        {Array.isArray(result?.data?.unmatched) && (result!.data!.unmatched as string[]).length ? (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <p className="font-medium">Not matched (credit these by hand below, or import again after tonight&apos;s sync):</p>
            <ul className="list-disc pl-4">
              {(result!.data!.unmatched as string[]).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SaleLine({ row, pickable, timezone }: { row: SaleRow; pickable: { id: string; name: string }[]; timezone: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [credits, setCredits] = useState(row.credits.map((credit) => ({ staffId: credit.staffId, share: String(credit.share) })));
  const [none, setNone] = useState(row.none);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = new Date(row.saleAt).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
  const label = row.none
    ? "None"
    : row.credits.length
      ? row.credits.map((credit) => `${credit.name}${credit.share < 100 ? ` (${credit.share}%)` : ""}`).join(", ")
      : "Not credited";

  async function save() {
    setBusy(true);
    setError(null);
    const result = await act({
      action: "credits",
      detailId: row.detailId,
      none,
      credits: none
        ? []
        : credits.filter((credit) => credit.staffId).map((credit) => ({ staffId: credit.staffId, share: Number(credit.share) })),
    });
    setBusy(false);
    if (result.error) return setError(result.error);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="space-y-2 px-6 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-14 text-muted-foreground">{day}</span>
        <span className="flex-1">
          {row.description} <span className="text-xs text-muted-foreground">· {CATEGORY_LABELS[row.category]}</span>
          {row.rungUpBy ? <span className="block text-xs text-muted-foreground">Rung up by {row.rungUpBy}</span> : null}
        </span>
        <span className="tabular-nums">{money(row.preTaxCents)}</span>
        <span className={`min-w-40 ${!row.none && row.credits.length === 0 ? "text-muted-foreground italic" : "font-medium"}`}>
          {label}
          {row.credits.some((credit) => credit.source === "import") ? (
            <Badge variant="secondary" className="ml-1">
              From Mindbody
            </Badge>
          ) : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? "Close" : "Change"}
        </Button>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} />
            None
          </label>
          {!none
            ? credits.map((credit, index) => (
                <span key={index} className="flex items-center gap-1">
                  <select
                    aria-label="Person"
                    className={`${selectClass} w-44`}
                    value={credit.staffId}
                    onChange={(e) => setCredits(credits.map((c, i) => (i === index ? { ...c, staffId: e.target.value } : c)))}
                  >
                    <option value="">Pick a person</option>
                    {pickable.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="Share"
                    className="h-9 w-16"
                    inputMode="decimal"
                    value={credit.share}
                    onChange={(e) => setCredits(credits.map((c, i) => (i === index ? { ...c, share: e.target.value } : c)))}
                  />
                  %
                  <Button size="sm" variant="ghost" onClick={() => setCredits(credits.filter((_, i) => i !== index))}>
                    ×
                  </Button>
                </span>
              ))
            : null}
          {!none && credits.length < 4 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setCredits(
                  credits.length === 1 && credits[0].share === "100"
                    ? [
                        { ...credits[0], share: "50" },
                        { staffId: "", share: "50" },
                      ]
                    : [...credits, { staffId: "", share: credits.length ? "50" : "100" }],
                )
              }
            >
              {credits.length ? "Split with someone" : "Add a person"}
            </Button>
          ) : null}
          <Button size="sm" disabled={busy} onClick={save}>
            Save
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function Plans({ plans, ptMonths }: { plans: CommissionPlan[]; ptMonths: number }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A plan says what a person earns on each kind of product. A rule pays a percent of the pre-tax price, a flat amount per unit, or
        both. &quot;No PT recently&quot; means no PT session in the last {ptMonths} months.
      </p>
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Add a plan</CardTitle>
        </CardHeader>
        <CardContent>
          <PlanForm />
        </CardContent>
      </Card>
    </div>
  );
}

function PlanCard({ plan }: { plan: CommissionPlan }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaults = [
    ...plan.defaultRoles.map((role) => ROLES.find((r) => r.value === role)?.label ?? role),
    plan.defaultTrainers ? "Trainers" : null,
  ].filter(Boolean);
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {plan.name}
          {!plan.defaultEnabled ? <Badge variant="secondary">Off unless switched on per person</Badge> : null}
        </CardTitle>
        <CardDescription>{defaults.length ? `Everyone who is: ${defaults.join(", ")}` : "Only people set to it"}</CardDescription>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? "Close" : "Edit plan"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const result = await act({ action: "archivePlan", id: plan.id });
              if (result.error) setError(result.error);
              else router.refresh();
            }}
          >
            Remove plan
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
        {editing ? <PlanForm plan={plan} onDone={() => setEditing(false)} /> : null}
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>On</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Pays</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell className="font-medium">{CATEGORY_LABELS[rule.category]}</TableCell>
              <TableCell className="text-sm">{CONDITION_LABELS[rule.condition]}</TableCell>
              <TableCell className="text-sm">{describeRule(rule)}</TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await act({ action: "removeRule", id: rule.id });
                    router.refresh();
                  }}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CardContent className="border-t pt-4 pb-6">
        <RuleForm planId={plan.id} />
      </CardContent>
    </Card>
  );
}

function PlanForm({ plan, onDone }: { plan?: CommissionPlan; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(plan?.name ?? "");
  const [roles, setRoles] = useState<string[]>(plan?.defaultRoles ?? []);
  const [trainers, setTrainers] = useState(plan?.defaultTrainers ?? false);
  const [enabled, setEnabled] = useState(plan?.defaultEnabled ?? true);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Input className="h-9 w-56" placeholder="Plan name (e.g. Sales Team)" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="text-muted-foreground">Everyone who is:</span>
        {ROLES.map((role) => (
          <label key={role.value} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={roles.includes(role.value)}
              onChange={(e) => setRoles(e.target.checked ? [...roles, role.value] : roles.filter((r) => r !== role.value))}
            />
            {role.label}
          </label>
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={trainers} onChange={(e) => setTrainers(e.target.checked)} />
          Trainers
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Pays them unless switched off per person
        </label>
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={async () => {
            setError(null);
            const result = await act({
              action: "plan",
              id: plan?.id,
              name,
              defaultRoles: roles,
              defaultTrainers: trainers,
              defaultEnabled: enabled,
            });
            if (result.error) return setError(result.error);
            if (!plan) setName("");
            onDone?.();
            router.refresh();
          }}
        >
          {plan ? "Save plan" : "Add plan"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function RuleForm({ planId }: { planId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState("membership");
  const [condition, setCondition] = useState("any");
  const [percent, setPercent] = useState("");
  const [flat, setFlat] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <select aria-label="Category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          {COMMISSION_CATEGORIES.filter((c) => c !== "none").map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select aria-label="When" className={`${selectClass} max-w-xs`} value={condition} onChange={(e) => setCondition(e.target.value)}>
          {COMMISSION_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
        <label className="text-xs text-muted-foreground">
          % of pre-tax
          <Input className="h-9 w-20" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          and/or $ per unit
          <Input className="h-9 w-24" inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value)} />
        </label>
        <Button
          size="sm"
          disabled={!percent && !flat}
          onClick={async () => {
            setError(null);
            const result = await act({ action: "rule", planId, category, condition, percent, flat });
            if (result.error) return setError(result.error);
            setPercent("");
            setFlat("");
            router.refresh();
          }}
        >
          Add rule
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function People({ people, plans }: { people: PersonRow[]; plans: CommissionPlan[] }) {
  const [filter, setFilter] = useState("");
  const shown = people.filter((person) => person.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>Who earns commission</CardTitle>
        <CardDescription>
          People get the plan for their role (or the trainer plan) automatically. Pick a plan to override it, or switch commission on or off
          for one person.
        </CardDescription>
        <Input className="mt-2 h-9 max-w-xs" placeholder="Find a person" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </CardHeader>
      <div className="divide-y border-t">
        {shown.map((person) => (
          <PersonLine key={person.id} person={person} plans={plans} />
        ))}
      </div>
    </Card>
  );
}

function PersonLine({ person, plans }: { person: PersonRow; plans: CommissionPlan[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function save(planId: string, enabled: string) {
    setError(null);
    const result = await act({ action: "person", staffId: person.id, planId, enabled });
    if (result.error) setError(result.error);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2 text-sm">
      <div className="min-w-48 flex-1">
        <span className="font-medium">{person.name}</span>{" "}
        <span className="text-xs text-muted-foreground">
          {person.role}
          {person.trainer ? " · Trainer" : ""}
        </span>
      </div>
      <span className="min-w-40 text-xs text-muted-foreground">Now: {person.effective}</span>
      <select
        aria-label="Plan"
        className={`${selectClass} w-48`}
        value={person.planId}
        onChange={(e) => save(e.target.value, person.enabled)}
      >
        <option value="">Plan for their role</option>
        {plans.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {plan.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Commission on or off"
        className={`${selectClass} w-36`}
        value={person.enabled}
        onChange={(e) => save(person.planId, e.target.value)}
      >
        <option value="default">Plan default</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

function Products({ products }: { products: ProductRow[] }) {
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<"all" | "paying">("paying");
  const shown = products
    .filter((product) => (only === "paying" ? product.category !== "none" : true))
    .filter((product) => product.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>What each product counts as</CardTitle>
        <CardDescription>
          New products show up here the first time they&apos;re sold, with a guess. Anything set to &quot;No commission&quot; never pays.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Input className="h-9 max-w-xs" placeholder="Find a product" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select aria-label="Show" className={selectClass} value={only} onChange={(e) => setOnly(e.target.value as "all" | "paying")}>
            <option value="paying">Only products that can pay commission</option>
            <option value="all">All products</option>
          </select>
        </div>
      </CardHeader>
      <div className="divide-y border-t">
        {shown.slice(0, 300).map((product) => (
          <ProductLine key={product.productId} product={product} />
        ))}
        {shown.length === 0 ? <p className="px-6 py-4 text-sm text-muted-foreground">Nothing matches.</p> : null}
      </div>
    </Card>
  );
}

function ProductLine({ product }: { product: ProductRow }) {
  const router = useRouter();
  const [category, setCategory] = useState(product.category);
  return (
    <div className="flex items-center justify-between gap-2 px-6 py-2 text-sm">
      <span>{product.name}</span>
      <select
        aria-label={`Category for ${product.name}`}
        className={`${selectClass} w-44`}
        value={category}
        onChange={async (e) => {
          const next = e.target.value as CommissionCategory;
          setCategory(next);
          await act({ action: "category", productId: product.productId, category: next });
          router.refresh();
        }}
      >
        {COMMISSION_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
    </div>
  );
}
