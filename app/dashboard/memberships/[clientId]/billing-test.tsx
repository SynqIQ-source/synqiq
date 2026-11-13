"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RESULT_LABELS, type ChargeResult } from "@/lib/billing/practice";

export type PracticeChargeRow = {
  id: string;
  name: string;
  dueDate: string;
  totalCents: number;
  result: ChargeResult;
  mindbodyTotalCents: number | null;
  mindbodyChargedOn: string | null;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d, yyyy");
const TONE: Record<ChargeResult, string> = {
  match: "bg-emerald-600 text-white hover:bg-emerald-600",
  date_differs: "bg-amber-500 text-white hover:bg-amber-500",
  amount_differs: "bg-red-600 text-white hover:bg-red-600",
  not_charged: "bg-red-600 text-white hover:bg-red-600",
  pending: "",
};

// Billing test on a member's Billing tab: SynqIQ's own billing dates for
// their imported Mindbody contract, a practice charge on each, and whether
// Mindbody charged the same. Nothing is charged.
export function BillingTest({ clientId, inTest, charges }: { clientId: string; inTest: boolean; charges: PracticeChargeRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(remove: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/test-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mindbodyClientId: clientId, remove }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) setError(result.error ?? "Couldn't save. Try again.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const matched = charges.filter((charge) => charge.result === "match").length;
  const problems = charges.filter((charge) => ["amount_differs", "not_charged", "date_differs"].includes(charge.result)).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing test (practice renewals)</CardTitle>
        <CardDescription>
          SynqIQ imports this member&apos;s Mindbody autopay once, works out every billing date itself, records a practice charge on each,
          and checks it against what Mindbody actually charged. Nothing is charged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {inTest ? (
            <>
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">In the billing test</Badge>
              <span className="text-sm text-muted-foreground">
                {matched} of {charges.length} match Mindbody{problems ? `, ${problems} to look at` : ""}. Checked nightly.
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(false)}>
                Check now
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(true)}>
                Remove from test
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => send(false)}>
              {busy ? "Importing…" : "Add to billing test"}
            </Button>
          )}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {inTest && charges.length ? (
          <div className="max-h-[24rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Billing date</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead className="text-right">SynqIQ would charge</TableHead>
                  <TableHead className="text-right">Mindbody charged</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell className="whitespace-nowrap">{day(charge.dueDate)}</TableCell>
                    <TableCell>{charge.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(charge.totalCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {charge.mindbodyTotalCents != null ? money(charge.mindbodyTotalCents) : "—"}
                      {charge.mindbodyChargedOn && charge.mindbodyChargedOn !== charge.dueDate ? (
                        <span className="block text-xs text-muted-foreground">on {day(charge.mindbodyChargedOn)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={charge.result === "pending" ? "outline" : "default"} className={TONE[charge.result]}>
                        {RESULT_LABELS[charge.result]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
