"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTaxRate, taxOn } from "@/lib/memberships/tax";
import { DEFAULT_NOTICE_BODY, DEFAULT_NOTICE_SUBJECT, renderNotice, type IncreaseFilters } from "@/lib/memberships/price-increase";

type Row = {
  contractId: string;
  mindbodyClientId: string;
  firstName: string;
  name: string;
  plan: string;
  since: string | null;
  oldCents: number;
  newCents: number;
  taxRate: number | null;
  alreadyScheduled: string | null;
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
const day = (iso: string | null) => (iso ? DateTime.fromISO(iso).toFormat("LLL d, yyyy") : "—");

export function ScheduleIncrease({
  rows,
  filters,
  percent,
  roundToDollar,
  cutover,
  today,
  studioName,
}: {
  rows: Row[];
  filters: IncreaseFilters;
  percent: number;
  roundToDollar: boolean;
  cutover: string;
  today: string;
  studioName: string;
}) {
  const router = useRouter();
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
  const earliest = cutover > tomorrow ? cutover : tomorrow;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [name, setName] = useState(`${percent}% dues increase`);
  const [effectiveOn, setEffectiveOn] = useState(earliest);
  const [subject, setSubject] = useState(DEFAULT_NOTICE_SUBJECT);
  const [body, setBody] = useState(DEFAULT_NOTICE_BODY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = rows.filter((row) => !row.alreadyScheduled);
  const picked = eligible.filter((row) => !excluded.has(row.contractId));
  const members = new Set(picked.map((row) => row.mindbodyClientId)).size;
  const monthlyOld = picked.reduce((sum, row) => sum + row.oldCents, 0);
  const monthlyNew = picked.reduce((sum, row) => sum + row.newCents, 0);
  const monthlyNewTax = picked.reduce((sum, row) => sum + (taxOn(row.newCents, row.taxRate) ?? 0), 0);

  const sample = picked[0];
  const sampleText = useMemo(() => {
    if (!sample) return "";
    const variables = {
      first_name: sample.firstName || "there",
      member_since: day(sample.since),
      effective_date: day(effectiveOn),
      plan: sample.plan,
      old_price: money(sample.oldCents),
      new_price: money(sample.newCents),
      studio_name: studioName,
    };
    return `Subject: ${renderNotice(subject, variables)}\n\n${renderNotice(body, variables)}`;
  }, [sample, subject, body, effectiveOn, studioName]);

  function toggle(contractId: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  }

  async function schedule() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/memberships/price-increases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          percent,
          roundToDollar,
          effectiveOn,
          filters,
          excludedContractIds: [...excluded],
          noticeSubject: subject,
          noticeBody: body,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        id?: string;
      };
      if (!response.ok || !result.success || !result.id) {
        setError(result.error ?? "Couldn't save. Try again.");
        return;
      }
      router.push(`/dashboard/memberships/price-increases/${result.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>
            Preview: {picked.length.toLocaleString()} memberships · {members.toLocaleString()} members
          </CardTitle>
          <CardDescription>
            Monthly base rate {money(monthlyOld)} → {money(monthlyNew)} (+
            {money(monthlyNew - monthlyOld)}); with tax {money(monthlyNew + monthlyNewTax)}. The increase applies to the base rate; tax is
            recalculated and can&apos;t be edited. Untick anyone to leave them out.
            {rows.length - eligible.length > 0 ? ` ${rows.length - eligible.length} already in a scheduled increase are left out.` : ""}
          </CardDescription>
        </CardHeader>
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No billing memberships match.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Include</span>
                  </TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Member since</TableHead>
                  <TableHead className="text-right">Base now</TableHead>
                  <TableHead className="text-right">New base</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">New total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.contractId} className={row.alreadyScheduled ? "text-muted-foreground" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Include ${row.name}`}
                        disabled={Boolean(row.alreadyScheduled)}
                        checked={!row.alreadyScheduled && !excluded.has(row.contractId)}
                        onChange={() => toggle(row.contractId)}
                      />
                    </TableCell>
                    <TableCell>
                      <a
                        href={`/dashboard/memberships/${row.mindbodyClientId}`}
                        className="underline-offset-4 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.name}
                      </a>
                      {row.alreadyScheduled ? <span className="block text-xs">In “{row.alreadyScheduled}”</span> : null}
                    </TableCell>
                    <TableCell>{row.plan}</TableCell>
                    <TableCell className="whitespace-nowrap">{day(row.since)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.oldCents)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(row.newCents)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.taxRate === null ? "—" : money(taxOn(row.newCents, row.taxRate) as number)}
                      <span className="block text-xs">{formatTaxRate(row.taxRate)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.taxRate === null ? "—" : money(row.newCents + (taxOn(row.newCents, row.taxRate) as number))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {picked.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              Saves the increase and a notice-email draft. Nothing is charged or emailed. Mindbody still charges until the switch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="increase-name">Name</Label>
                <Input id="increase-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="increase-effective">New prices start</Label>
                <Input
                  id="increase-effective"
                  type="date"
                  min={earliest}
                  value={effectiveOn}
                  onChange={(event) => setEffectiveOn(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">On or after the billing switch ({day(cutover)}).</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="notice-subject">Notice email (draft, not sent)</Label>
                <Input id="notice-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
                <Textarea
                  id="notice-body"
                  aria-label="Notice email body"
                  rows={10}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Fills in: {"{first_name} {member_since} {effective_date} {plan} {old_price} {new_price} {studio_name}"}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Preview for {sample?.name}</Label>
                <pre className="min-h-56 whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">{sampleText}</pre>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={schedule} disabled={saving}>
                {saving ? "Scheduling…" : `Schedule for ${picked.length.toLocaleString()} memberships`}
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
