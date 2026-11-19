import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// A paid renewal becomes a sale (source 'renewal', no staff member), one line
// per dues part in its revenue category, so monthly dues show in the sales
// reports and on the member's purchases. Test-mode renewals are practice
// sales (paid with card_test), like test card sales at the POS.

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type RecurringLine = {
  label?: string;
  revenueCategoryId?: string;
  revenueCategory?: string | null;
  amountCents?: number;
  taxable?: boolean;
  taxCents?: number;
};

// Each line's amount and tax, adjusted so the lines add up to the charge exactly.
export function renewalLines(lines: RecurringLine[], subtotalCents: number, taxCents: number) {
  const clean = lines.length
    ? lines.map((line) => ({
        label: line.label || "Monthly dues",
        revenueCategoryId: line.revenueCategoryId ?? null,
        revenueCategory: line.revenueCategory ?? null,
        amountCents: Math.max(0, Math.round(Number(line.amountCents ?? 0))),
        taxable: Boolean(line.taxable),
        taxCents: Math.max(0, Math.round(Number(line.taxCents ?? 0))),
      }))
    : [
        {
          label: "Monthly dues",
          revenueCategoryId: null,
          revenueCategory: null,
          amountCents: subtotalCents,
          taxable: taxCents > 0,
          taxCents,
        },
      ];
  const amountGap = subtotalCents - clean.reduce((sum, line) => sum + line.amountCents, 0);
  clean[clean.length - 1].amountCents += amountGap;
  const taxGap = taxCents - clean.reduce((sum, line) => sum + line.taxCents, 0);
  const taxed = [...clean].reverse().find((line) => line.taxable) ?? clean[clean.length - 1];
  taxed.taxCents = Math.max(0, taxed.taxCents + taxGap);
  return clean;
}

export async function recordRenewalSale(admin: Admin, chargeId: string): Promise<string | null> {
  const { data: charge } = await admin
    .from("membership_charges")
    .select(
      "id, organization_id, schedule_id, due_date, subtotal_cents, tax_cents, total_cents, livemode, payment_intent_id, sale_id, status",
    )
    .eq("id", chargeId)
    .maybeSingle();
  if (!charge || charge.status !== "paid" || charge.sale_id) return (charge?.sale_id as string | null) ?? null;
  const [{ data: schedule }, { data: org }] = await Promise.all([
    admin
      .from("member_billing_schedules")
      .select("name, mindbody_client_id, crm_contact_id, client_name, recurring_lines, pos_item_id")
      .eq("id", charge.schedule_id)
      .maybeSingle(),
    admin.from("organizations").select("sales_tax_rate").eq("id", charge.organization_id).maybeSingle(),
  ]);
  if (!schedule) return null;
  const month = DateTime.fromISO(charge.due_date as string).toFormat("LLL yyyy");
  const lines = renewalLines(
    (schedule.recurring_lines as RecurringLine[] | null) ?? [],
    Number(charge.subtotal_cents),
    Number(charge.tax_cents),
  );
  const { data: sale, error } = await admin
    .from("pos_sales")
    .insert({
      organization_id: charge.organization_id,
      source: "renewal",
      status: charge.livemode ? "completed" : "practice",
      mindbody_client_id: schedule.mindbody_client_id,
      crm_contact_id: schedule.crm_contact_id ?? null,
      client_name: schedule.client_name,
      staff_id: null,
      subtotal_cents: Number(charge.subtotal_cents),
      discount_cents: 0,
      tax_cents: Number(charge.tax_cents),
      total_cents: Number(charge.total_cents),
      tax_rate: Number(org?.sales_tax_rate ?? 0.0825),
      payment_method: charge.livemode ? "card" : "card_test",
      payment_ref: charge.payment_intent_id,
      note: `Automatic renewal · ${schedule.name} · ${month}`,
    })
    .select("id")
    .single();
  if (error || !sale) {
    console.error("[billing/renewal-sale] sale not saved:", chargeId, error?.message);
    return null;
  }
  const { error: lineError } = await admin.from("pos_sale_lines").insert(
    lines.map((line, index) => ({
      organization_id: charge.organization_id,
      sale_id: sale.id,
      pos_item_id: schedule.pos_item_id ?? null,
      name: `${schedule.name} · ${line.label} · ${month}`,
      kind: "membership",
      revenue_category_id: line.revenueCategoryId,
      revenue_category: line.revenueCategory,
      quantity: 1,
      unit_price_cents: line.amountCents,
      taxable: line.taxable,
      tax_cents: line.taxCents,
      total_cents: line.amountCents + line.taxCents,
      recurring: true,
      line_number: index + 1,
    })),
  );
  if (lineError) {
    await admin.from("pos_sales").delete().eq("id", sale.id);
    console.error("[billing/renewal-sale] lines not saved:", chargeId, lineError.message);
    return null;
  }
  // Only one sale per charge, even if two finishers race.
  const { data: claimed } = await admin
    .from("membership_charges")
    .update({ sale_id: sale.id })
    .eq("id", chargeId)
    .is("sale_id", null)
    .select("id");
  if (!claimed?.length) {
    await admin.from("pos_sales").delete().eq("id", sale.id);
    return null;
  }
  return sale.id as string;
}
