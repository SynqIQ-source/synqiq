"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PayRate } from "@/lib/payroll/rates";

export type RateRow = PayRate & { summary: string };
export type PayTarget = {
  scope: "class_schedule" | "class_type" | "session_type";
  mindbodyId: number;
  label: string;
  staffId: string | null; // the schedule's regular instructor, to list their classes first
};
export type PayPerson = {
  id: string;
  name: string;
  tags: string[];
  hourly: string;
  classRateId: string;
  appointmentRateId: string;
  exceptions: { id: string; scope: PayTarget["scope"]; mindbodyId: number; label: string; payRateId: string }[];
};

async function post(url: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    return response.ok && result.success ? null : (result.error ?? "Couldn't save. Try again.");
  } catch {
    return "Couldn't reach SynqIQ. Try again.";
  }
}

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
const cents = (value: number | null) => (value == null ? "" : (value / 100).toFixed(2).replace(/\.00$/, ""));

export function PayRatesEditor({ rates, people, targets }: { rates: RateRow[]; people: PayPerson[]; targets: PayTarget[] }) {
  const [filter, setFilter] = useState("");
  const shown = people.filter((person) => person.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <div className="space-y-6">
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Rates</CardTitle>
          <CardDescription>
            Class rates: a base, plus an amount for each paid client above a number, up to a cap (leave the per-person amount at 0 for a
            flat rate). Session rates: a percent of what the client paid per session (pack price ÷ sessions; a comp session is $0), or a
            flat amount per session.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Pays</TableHead>
              <TableHead className="text-right">Used by</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate) => (
              <RateLine key={rate.id} rate={rate} usedBy={usage(rate.id, people)} />
            ))}
          </TableBody>
        </Table>
        <CardContent className="border-t pt-4 pb-6">
          <RateForm />
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Who is paid what</CardTitle>
          <CardDescription>
            Hourly pay uses time clock hours. A person&apos;s class and session rates apply to every class or session they teach, unless an
            exception sets a different rate for one class, class type or session type.
          </CardDescription>
          <Input
            className="mt-2 h-9 max-w-xs"
            placeholder="Find a person"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </CardHeader>
        <div className="divide-y border-t">
          {shown.map((person) => (
            <PersonPay key={person.id} person={person} rates={rates} targets={targets} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function usage(rateId: string, people: PayPerson[]) {
  return people.filter(
    (person) =>
      person.classRateId === rateId || person.appointmentRateId === rateId || person.exceptions.some((e) => e.payRateId === rateId),
  ).length;
}

function RateLine({ rate, usedBy }: { rate: RateRow; usedBy: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={5}>
          <RateForm rate={rate} onDone={() => setEditing(false)} />
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{rate.name}</TableCell>
      <TableCell>{rate.appliesTo === "class" ? "Classes" : "Sessions"}</TableCell>
      <TableCell className="text-sm">{rate.summary}</TableCell>
      <TableCell className="text-right tabular-nums">{usedBy}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={usedBy > 0}
          title={usedBy > 0 ? "Move everyone off this rate first" : undefined}
          onClick={async () => {
            const problem = await post("/api/payroll/rates", { id: rate.id, archive: true });
            if (problem) setError(problem);
            else router.refresh();
          }}
        >
          Remove
        </Button>
        {error ? <span className="block text-xs text-destructive">{error}</span> : null}
      </TableCell>
    </TableRow>
  );
}

function RateForm({ rate, onDone }: { rate?: RateRow; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(rate?.name ?? "");
  const [appliesTo, setAppliesTo] = useState<"class" | "appointment">(rate?.appliesTo ?? "class");
  const [method, setMethod] = useState<PayRate["method"]>(rate?.method ?? "class_formula");
  const [base, setBase] = useState(cents(rate?.baseCents ?? null));
  const [perHead, setPerHead] = useState(cents(rate?.perHeadCents ?? null));
  const [headsAbove, setHeadsAbove] = useState(String(rate?.headsAbove ?? 0));
  const [cap, setCap] = useState(cents(rate?.capCents ?? null));
  const [percent, setPercent] = useState(rate?.percent == null ? "" : String(rate.percent));
  const [flat, setFlat] = useState(cents(rate?.flatCents ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods =
    appliesTo === "class"
      ? [
          { value: "class_formula", label: "Base + per person" },
          { value: "flat", label: "Flat per class" },
        ]
      : [
          { value: "percent", label: "% of session value" },
          { value: "flat", label: "Flat per session" },
        ];

  async function save() {
    setSaving(true);
    setError(null);
    const problem = await post("/api/payroll/rates", {
      id: rate?.id,
      name,
      appliesTo,
      method,
      base,
      perHead,
      headsAbove: Number(headsAbove || 0),
      cap,
      percent,
      flat,
    });
    setSaving(false);
    if (problem) return setError(problem);
    if (!rate) {
      setName("");
      setBase("");
      setPerHead("");
      setHeadsAbove("0");
      setCap("");
      setPercent("");
      setFlat("");
    }
    onDone?.();
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {!rate ? <p className="text-sm font-medium">Add a rate</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Input className="h-9 w-52" placeholder="Name (e.g. Peak Incentive)" value={name} onChange={(e) => setName(e.target.value)} />
        <select
          aria-label="For"
          className={selectClass}
          value={appliesTo}
          onChange={(e) => {
            const next = e.target.value as "class" | "appointment";
            setAppliesTo(next);
            setMethod(next === "class" ? "class_formula" : "percent");
          }}
        >
          <option value="class">Classes</option>
          <option value="appointment">Sessions (PT, intros)</option>
        </select>
        <select aria-label="How" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as PayRate["method"])}>
          {methods.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {method === "class_formula" ? (
          <>
            <Money label="Base" value={base} onChange={setBase} />
            <Money label="Per person" value={perHead} onChange={setPerHead} />
            <label className="text-xs text-muted-foreground">
              above
              <Input className="h-9 w-16" inputMode="numeric" value={headsAbove} onChange={(e) => setHeadsAbove(e.target.value)} />
            </label>
            <Money label="Cap (optional)" value={cap} onChange={setCap} />
          </>
        ) : null}
        {method === "percent" ? (
          <label className="text-xs text-muted-foreground">
            Percent
            <Input className="h-9 w-20" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
        ) : null}
        {method === "flat" ? <Money label="Amount" value={flat} onChange={setFlat} /> : null}
        <Button size="sm" disabled={saving || !name.trim()} onClick={save}>
          {rate ? "Save" : "Add rate"}
        </Button>
        {onDone ? (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input className="h-9 w-24 pl-5" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

function PersonPay({ person, rates, targets }: { person: PayPerson; rates: RateRow[]; targets: PayTarget[] }) {
  const router = useRouter();
  const [hourly, setHourly] = useState(person.hourly);
  const [classRateId, setClassRateId] = useState(person.classRateId);
  const [appointmentRateId, setAppointmentRateId] = useState(person.appointmentRateId);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = hourly !== person.hourly || classRateId !== person.classRateId || appointmentRateId !== person.appointmentRateId;
  const classRates = rates.filter((rate) => rate.appliesTo === "class");
  const sessionRates = rates.filter((rate) => rate.appliesTo === "appointment");
  const rateName = (id: string) => rates.find((rate) => rate.id === id)?.name ?? "Removed rate";

  async function save() {
    setMessage(null);
    const problem = await post("/api/payroll/staff", { staffId: person.id, hourly, classRateId, appointmentRateId });
    setMessage(problem ? { ok: false, text: problem } : { ok: true, text: "Saved." });
    if (!problem) router.refresh();
  }

  return (
    <div className="space-y-2 px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <p className="font-medium">{person.name}</p>
          <div className="flex flex-wrap gap-1">
            {person.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <label className="text-xs text-muted-foreground">
          Hourly
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              className="h-9 w-24 pl-5"
              inputMode="decimal"
              placeholder="none"
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
            />
          </div>
        </label>
        <label className="text-xs text-muted-foreground">
          Classes
          <select className={`${selectClass} block w-48`} value={classRateId} onChange={(e) => setClassRateId(e.target.value)}>
            <option value="">Not paid for classes</option>
            {classRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {rate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Sessions
          <select className={`${selectClass} block w-48`} value={appointmentRateId} onChange={(e) => setAppointmentRateId(e.target.value)}>
            <option value="">Not paid for sessions</option>
            {sessionRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {rate.name}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" disabled={!dirty} onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          Exceptions ({person.exceptions.length})
        </Button>
      </div>
      {message ? (
        <p className={`text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>
      ) : null}
      {open ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {person.exceptions.length === 0 ? <p className="text-sm text-muted-foreground">No exceptions.</p> : null}
          {person.exceptions.map((exception) => (
            <ExceptionLine key={exception.id} exception={exception} rateName={rateName(exception.payRateId)} />
          ))}
          <AddException person={person} rates={rates} targets={targets} />
        </div>
      ) : null}
    </div>
  );
}

function ExceptionLine({ exception, rateName }: { exception: PayPerson["exceptions"][number]; rateName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>
        {exception.label} → <span className="font-medium">{rateName}</span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await post("/api/payroll/assignments", { id: exception.id, remove: true });
          setBusy(false);
          router.refresh();
        }}
      >
        Remove
      </Button>
    </div>
  );
}

function AddException({ person, rates, targets }: { person: PayPerson; rates: RateRow[]; targets: PayTarget[] }) {
  const router = useRouter();
  const [targetKey, setTargetKey] = useState("");
  const [rateId, setRateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Their own classes first, then class types, then everyone else's classes, then session types.
  const ordered = useMemo(() => {
    const rank = (target: PayTarget) =>
      target.scope === "class_schedule" ? (target.staffId === person.id ? 0 : 2) : target.scope === "class_type" ? 1 : 3;
    return [...targets].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  }, [targets, person.id]);
  const target = ordered.find((t) => `${t.scope}:${t.mindbodyId}` === targetKey);
  const fitting = rates.filter((rate) =>
    target?.scope === "session_type" ? rate.appliesTo === "appointment" : rate.appliesTo === "class",
  );

  async function add() {
    if (!target) return;
    setError(null);
    const problem = await post("/api/payroll/assignments", {
      staffId: person.id,
      scope: target.scope,
      mindbodyId: target.mindbodyId,
      label: target.label,
      payRateId: rateId,
    });
    if (problem) return setError(problem);
    setTargetKey("");
    setRateId("");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Class or session"
        className={`${selectClass} w-80`}
        value={targetKey}
        onChange={(e) => setTargetKey(e.target.value)}
      >
        <option value="">Pick a class, class type or session type…</option>
        {ordered.map((t) => (
          <option key={`${t.scope}:${t.mindbodyId}`} value={`${t.scope}:${t.mindbodyId}`}>
            {t.scope === "class_schedule" && t.staffId === person.id ? "★ " : ""}
            {t.scope === "session_type" ? `Session: ${t.label}` : t.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Rate"
        className={`${selectClass} w-48`}
        value={rateId}
        onChange={(e) => setRateId(e.target.value)}
        disabled={!target}
      >
        <option value="">Rate…</option>
        {fitting.map((rate) => (
          <option key={rate.id} value={rate.id}>
            {rate.name}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={!target || !rateId} onClick={add}>
        Add exception
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
