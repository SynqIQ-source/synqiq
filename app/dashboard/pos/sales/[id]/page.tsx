import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { canCheckout } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canVoidSale } from "@/lib/pos/sales";
import { PrintButton, VoidSale } from "./receipt-actions";

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

// One checkout sale: the receipt (print / reprint), commission choices, and
// void with a reason.
export default async function PosSalePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireAccess(canCheckout);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = createSupabaseAdminClient();
  const [{ data: sale }, { data: org }] = await Promise.all([
    admin.from("pos_sales").select("*").eq("id", id).eq("organization_id", staff.organizationId).maybeSingle(),
    admin.from("organizations").select("name, timezone").eq("id", staff.organizationId).maybeSingle(),
  ]);
  if (!sale) notFound();
  const seesAll = staff.role === "admin" || staff.role === "sales_lead";
  if (!seesAll && sale.staff_id !== staff.id) notFound();
  const [{ data: lines }, { data: people }] = await Promise.all([
    admin.from("pos_sale_lines").select("*").eq("sale_id", id).order("line_number"),
    admin.from("staff").select("id, display_name").eq("organization_id", staff.organizationId),
  ]);
  const nameOf = new Map((people ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const voided = sale.status === "voided";
  const mayVoid = !voided && canVoidSale(staff, { staffId: sale.staff_id as string, createdAt: sale.created_at as string }, new Date());

  return (
    <DashboardShell
      title={`Sale #${sale.sale_number}`}
      description={`${DateTime.fromISO(sale.created_at as string)
        .setZone(zone)
        .toFormat("cccc, LLL d, yyyy 'at' h:mm a")} · rung up by ${nameOf.get(sale.staff_id as string) ?? "Unknown"}`}
      actions={
        <div className="flex gap-2 print:hidden">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/pos/sales">All sales</Link>
          </Button>
          <PrintButton />
        </div>
      }
    >
      <div className="mx-auto max-w-md space-y-4">
        {voided ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm print:hidden">
            <span className="font-medium">Voided</span> by {nameOf.get(sale.voided_by_staff_id as string) ?? "Unknown"}
            {sale.voided_at
              ? ` on ${DateTime.fromISO(sale.voided_at as string)
                  .setZone(zone)
                  .toFormat("LLL d 'at' h:mm a")}`
              : ""}
            : {sale.void_reason as string}
          </p>
        ) : null}
        <Card>
          <CardHeader className="text-center">
            <CardTitle>{(org?.name as string | null) ?? "Receipt"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sale #{sale.sale_number} ·{" "}
              {DateTime.fromISO(sale.created_at as string)
                .setZone(zone)
                .toFormat("LLL d, yyyy h:mm a")}
            </p>
            <p className="text-sm">{(sale.client_name as string | null) ?? "Walk-in"}</p>
            {sale.status === "practice" ? (
              <Badge variant="secondary" className="mx-auto">
                Practice sale · not charged
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(lines ?? []).map((line) => {
              const credits = (line.commission_credits as { staffId: string; share: number }[] | null) ?? [];
              return (
                <div key={line.id as string}>
                  <div className="flex justify-between">
                    <span>
                      {line.quantity} × {line.name}
                    </span>
                    <span className="tabular-nums">{money(Number(line.total_cents) - Number(line.tax_cents))}</span>
                  </div>
                  {Number(line.discount_cents) ? (
                    <p className="text-xs text-muted-foreground">
                      {money(Number(line.unit_price_cents) * Number(line.quantity))} less {money(Number(line.discount_cents))} discount
                    </p>
                  ) : null}
                  {line.no_commission || credits.length ? (
                    <p className="text-xs text-muted-foreground print:hidden">
                      Commission:{" "}
                      {line.no_commission
                        ? "None"
                        : credits
                            .map((credit) => `${nameOf.get(credit.staffId) ?? "Unknown"}${credit.share < 100 ? ` (${credit.share}%)` : ""}`)
                            .join(", ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="space-y-1 border-t pt-2">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(Number(sale.subtotal_cents))}</span>
              </div>
              {Number(sale.discount_cents) ? (
                <div className="flex justify-between">
                  <span>Discounts{sale.promo_code ? ` (incl. code ${sale.promo_code})` : ""}</span>
                  <span className="tabular-nums">−{money(Number(sale.discount_cents))}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span>Tax ({(Number(sale.tax_rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%)</span>
                <span className="tabular-nums">{money(Number(sale.tax_cents))}</span>
              </div>
              <div className={`flex justify-between text-base font-semibold ${voided ? "line-through" : ""}`}>
                <span>Total</span>
                <span className="tabular-nums">{money(Number(sale.total_cents))}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        {mayVoid ? <VoidSale saleId={id} /> : null}
      </div>
    </DashboardShell>
  );
}
