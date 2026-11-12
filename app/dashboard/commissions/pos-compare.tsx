import Link from "next/link";
import { DateTime } from "luxon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PosCommissionResult } from "@/lib/payroll/pos-commission";

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

// Commission from SynqIQ POS sales next to Mindbody's, per person, for the
// same dates. Practice sales are never paid: this is for checking that the
// POS credits commission the way Mindbody does before the switch.
export function PosCommissionCompare({
  timezone,
  saleCount,
  results,
  mindbodyByStaff,
}: {
  timezone: string;
  saleCount: number;
  results: (PosCommissionResult & { staffName: string })[];
  mindbodyByStaff: Record<string, number>;
}) {
  const posBy = new Map<string, number>();
  for (const row of results) posBy.set(row.staffName, (posBy.get(row.staffName) ?? 0) + row.amountCents);
  const names = [...new Set([...posBy.keys(), ...Object.keys(mindbodyByStaff)])].sort();
  const posTotal = results.reduce((sum, row) => sum + row.amountCents, 0);
  const mbTotal = Object.values(mindbodyByStaff).reduce((sum, cents) => sum + cents, 0);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>SynqIQ POS commission (practice)</CardTitle>
        <CardDescription>
          Commission on sales rung up at SynqIQ&apos;s POS, figured with the same plans, next to Mindbody&apos;s for these dates. Practice
          sales are not in payroll and are never paid; this is to check the two match before the switch.
          {saleCount ? ` ${saleCount} POS sale${saleCount === 1 ? "" : "s"} in this range.` : " No POS sales in this range."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {names.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-right">Mindbody</TableHead>
                <TableHead className="text-right">SynqIQ POS</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {names.map((name) => {
                const mb = mindbodyByStaff[name] ?? 0;
                const pos = posBy.get(name) ?? 0;
                return (
                  <TableRow key={name}>
                    <TableCell>{name}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(mb)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(pos)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${pos !== mb ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                    >
                      {pos === mb ? "—" : money(pos - mb)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(mbTotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(posTotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {posTotal === mbTotal ? "—" : money(posTotal - mbTotal)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No commission from either system in this range.</p>
        )}
        {results.length ? (
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sale</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Earns</TableHead>
                  <TableHead className="text-right">Pre-tax</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={`${row.lineId}|${row.staffId}`}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/dashboard/pos/sales/${row.saleId}`} className="text-primary underline">
                        #{row.saleNumber}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {DateTime.fromISO(row.saleAt).setZone(timezone).toFormat("LLL d, h:mm a")}
                        {row.clientName ? ` · ${row.clientName}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>{row.description}</TableCell>
                    <TableCell>
                      {row.staffName}
                      {row.sharePercent < 100 ? <span className="text-xs text-muted-foreground"> ({row.sharePercent}%)</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.baseCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.rule}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.amountCents)}</TableCell>
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
