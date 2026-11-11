import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { canCheckout } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { endOfDaySummary } from "@/lib/pos/sales";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };
const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAYMENT_LABELS: Record<string, string> = {
  practice: "Practice (not charged)",
  card_present: "Card",
  card_on_file: "Card on file",
  cash: "Cash",
  account: "Account",
};

// Checkout sales for a day (or range) with the end-of-day summary. Club Admins
// and Sales Leads see every sale; everyone else sees the sales they rang up.
export default async function PosSalesPage({ searchParams }: Props) {
  const staff = await requireAccess(canCheckout);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const params = await searchParams;
  const today = DateTime.now().setZone(zone).toISODate()!;
  const valid = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const from = valid(params.from) ?? today;
  const to = valid(params.to) && valid(params.to)! >= from ? valid(params.to)! : from;
  const seesAll = staff.role === "admin" || staff.role === "sales_lead";

  let query = admin
    .from("pos_sales")
    .select(
      "id, sale_number, status, client_name, staff_id, total_cents, tax_cents, discount_cents, payment_method, created_at, void_reason, promo_code",
    )
    .eq("organization_id", staff.organizationId)
    .gte("created_at", DateTime.fromISO(from, { zone }).startOf("day").toUTC().toISO()!)
    .lt("created_at", DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!seesAll) query = query.eq("staff_id", staff.id);
  const { data: sales } = await query;
  const saleIds = (sales ?? []).map((sale) => sale.id as string);
  const [{ data: lines }, { data: people }] = await Promise.all([
    saleIds.length
      ? admin.from("pos_sale_lines").select("sale_id, revenue_category, total_cents, tax_cents, discount_cents").in("sale_id", saleIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    admin.from("staff").select("id, display_name").eq("organization_id", staff.organizationId),
  ]);
  const nameOf = new Map((people ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const summary = endOfDaySummary(
    (sales ?? []).map((sale) => ({
      status: sale.status as string,
      paymentMethod: PAYMENT_LABELS[sale.payment_method as string] ?? (sale.payment_method as string),
      staffName: nameOf.get(sale.staff_id as string) ?? "Unknown",
      totalCents: Number(sale.total_cents),
      lines: (lines ?? [])
        .filter((line) => line.sale_id === sale.id)
        .map((line) => ({
          revenueCategory: (line.revenue_category as string | null) ?? null,
          totalCents: Number(line.total_cents),
          taxCents: Number(line.tax_cents),
          discountCents: Number(line.discount_cents),
        })),
    })),
  );
  const range =
    from === to
      ? DateTime.fromISO(from).toFormat("cccc, LLL d")
      : `${DateTime.fromISO(from).toFormat("LLL d")} – ${DateTime.fromISO(to).toFormat("LLL d")}`;

  return (
    <DashboardShell
      title="Checkout Sales"
      description={seesAll ? "Every checkout sale, with the end-of-day totals." : "The checkout sales you rang up."}
      actions={
        <Button asChild size="sm">
          <Link href="/dashboard/pos">New sale</Link>
        </Button>
      }
    >
      <div className="space-y-6">
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
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/pos/sales">Today</Link>
          </Button>
        </form>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>
              End of day · {range}: {money(summary.totalCents)}
            </CardTitle>
            <CardDescription>
              {summary.sales} sale{summary.sales === 1 ? "" : "s"}
              {summary.voided ? `, ${summary.voided} voided (not counted)` : ""} · tax {money(summary.taxCents)} · discounts{" "}
              {money(summary.discountCents)}. Practice sales are included so the totals can be checked; no money moved.
            </CardDescription>
          </CardHeader>
          <div className="grid gap-0 border-t md:grid-cols-3 md:divide-x">
            {(
              [
                ["By payment", summary.byPayment, "sales"],
                ["By revenue category (before tax)", summary.byCategory, "lines"],
                ["By who rang it up", summary.byStaff, "sales"],
              ] as const
            ).map(([title, rows, unit]) => (
              <div key={title} className="p-4">
                <p className="mb-2 text-sm font-medium">{title}</p>
                {rows.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : null}
                {rows.map((row) => (
                  <div key={row.key} className="flex justify-between text-sm">
                    <span>
                      {row.key}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({row.count} {unit})
                      </span>
                    </span>
                    <span className="tabular-nums">{money(row.cents)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Sales</CardTitle>
          </CardHeader>
          {(sales ?? []).length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No sales in these dates.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Rung up by</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sales ?? []).map((sale) => (
                  <TableRow key={sale.id as string} className={sale.status === "voided" ? "opacity-60" : ""}>
                    <TableCell>
                      <Link href={`/dashboard/pos/sales/${sale.id}`} className="font-medium hover:underline">
                        {String(sale.sale_number)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {DateTime.fromISO(sale.created_at as string)
                        .setZone(zone)
                        .toFormat("LLL d, h:mm a")}
                    </TableCell>
                    <TableCell>{(sale.client_name as string | null) ?? "Walk-in"}</TableCell>
                    <TableCell className="text-sm">{nameOf.get(sale.staff_id as string) ?? "Unknown"}</TableCell>
                    <TableCell className="text-sm">
                      {PAYMENT_LABELS[sale.payment_method as string] ?? (sale.payment_method as string)}
                      {sale.status === "voided" ? (
                        <Badge variant="destructive" className="ml-1">
                          Voided
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${sale.status === "voided" ? "line-through" : ""}`}>
                      {money(Number(sale.total_cents))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
