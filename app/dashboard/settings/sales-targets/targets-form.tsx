"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KPI_SECTIONS } from "@/lib/crm/kpis";

export function TargetsForm({
  month,
  months,
  staffId,
  salespeople,
  initial,
  carriedFrom,
  hasOwn,
}: {
  month: string;
  months: { value: string; label: string }[];
  staffId: string | null;
  salespeople: { id: string; name: string }[];
  initial: Record<string, number>;
  // Set when this month has no targets of its own and shows an earlier
  // month's (they carry forward).
  carriedFrom: string | null;
  hasOwn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial).map(([metric, value]) => [metric, String(value)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const monthLabel = months.find((option) => option.value === month)?.label ?? month;
  const who = staffId ? (salespeople.find((person) => person.id === staffId)?.name ?? "Salesperson") : "the whole club";

  function setParam(name: "month" | "staff", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (name === "staff" && value === "club") params.delete("staff");
    else params.set(name, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const targets = Object.fromEntries(
        KPI_SECTIONS.flatMap((section) => section.metrics).map((metric) => [
          metric.key,
          values[metric.key]?.trim() || null,
        ]),
      );
      const response = await fetch("/api/crm/kpi-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, staffId, targets }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={(value) => setParam("month", value)}>
          <SelectTrigger aria-label="Month" className="min-w-[180px] bg-card">
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {months.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={staffId ?? "club"} onValueChange={(value) => setParam("staff", value)}>
          <SelectTrigger aria-label="Targets for" className="min-w-[180px] bg-card">
            <span className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="club">Whole club</SelectItem>
            {salespeople.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        Targets for <span className="font-medium text-foreground">{who}</span> in {monthLabel}.{" "}
        {carriedFrom
          ? `None set for this month yet, so ${carriedFrom}'s targets apply. Saving sets them for ${monthLabel} onward.`
          : hasOwn
            ? `These carry forward to later months until you change them.`
            : "No targets set yet. Leave a box blank for no target."}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {KPI_SECTIONS.map((section) => (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>Monthly target{section.metrics.length > 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {section.metrics.map((metric) => (
                <div key={metric.key} className="space-y-1.5">
                  <Label htmlFor={`target-${metric.key}`}>{metric.label}</Label>
                  <div className="relative">
                    <Input
                      id={`target-${metric.key}`}
                      inputMode="decimal"
                      placeholder="—"
                      value={values[metric.key] ?? ""}
                      onChange={(event) => {
                        setSaved(false);
                        setValues((current) => ({
                          ...current,
                          [metric.key]: event.target.value,
                        }));
                      }}
                      className={metric.kind === "percent" ? "pr-7" : undefined}
                    />
                    {metric.kind === "percent" ? (
                      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                        %
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : `Save ${monthLabel} targets`}
        </Button>
        {saved ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </form>
  );
}
