import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canDiscountAtCheckout } from "@/lib/permissions";
import { computeCart, COMMISSIONABLE_CATEGORY_KEYS, promoProblem, type PromoInput } from "@/lib/pos/cart";
import { isTaxable } from "@/lib/pos/catalog";
import type { CurrentStaff } from "@/lib/current-staff";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type SaleLineRequest = {
  itemId: string;
  quantity: number;
  discount?: { kind: "percent" | "amount"; value: number } | null; // amount in cents
  credits?: { staffId: string; share: number }[];
  none?: boolean;
};

export async function findPromo(admin: Admin, organizationId: string, code: string, timezone: string) {
  const clean = code.trim().toUpperCase();
  if (!clean) return { promo: null, error: null };
  const { data } = await admin
    .from("promo_codes")
    .select("id, code, kind, percent, amount_cents, revenue_category_ids, starts_on, ends_on, max_uses, uses, active")
    .eq("organization_id", organizationId)
    .eq("code", clean)
    .eq("active", true)
    .maybeSingle();
  if (!data) return { promo: null, error: "That code doesn't exist." };
  const problem = promoProblem(
    {
      active: Boolean(data.active),
      starts_on: (data.starts_on as string | null) ?? null,
      ends_on: (data.ends_on as string | null) ?? null,
      max_uses: data.max_uses == null ? null : Number(data.max_uses),
      uses: Number(data.uses ?? 0),
    },
    DateTime.now().setZone(timezone).toISODate()!,
  );
  if (problem) return { promo: null, error: problem };
  const promo: PromoInput & { id: string; code: string } = {
    id: data.id as string,
    code: data.code as string,
    kind: data.kind as "percent" | "amount",
    percent: data.percent == null ? null : Number(data.percent),
    amountCents: data.amount_cents == null ? null : Number(data.amount_cents),
    categoryIds: (data.revenue_category_ids as string[] | null) ?? null,
  };
  return { promo, error: null };
}

// Save a PRACTICE sale: prices, tax and promo are recomputed from the catalog
// on the server; commission choices are required on commissionable lines.
export async function savePracticeSale(
  staff: CurrentStaff,
  input: { clientId: string | null; clientName: string | null; lines: SaleLineRequest[]; promoCode: string | null; note: string | null },
): Promise<{ error: string } | { saleId: string; saleNumber: number }> {
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  if (input.lines.length === 0) return { error: "The cart is empty." };
  if (input.lines.length > 100) return { error: "Too many lines." };
  const [{ data: orgRow }, { data: items }, { data: categories }] = await Promise.all([
    admin.from("organizations").select("sales_tax_rate, timezone").eq("id", org).maybeSingle(),
    admin
      .from("pos_items")
      .select("id, name, kind, price_cents, revenue_category_id, taxable, active")
      .eq("organization_id", org)
      .in(
        "id",
        input.lines.map((line) => line.itemId),
      ),
    admin.from("revenue_categories").select("id, key, name, taxable").eq("organization_id", org),
  ]);
  const itemBy = new Map((items ?? []).map((item) => [item.id as string, item]));
  const categoryBy = new Map((categories ?? []).map((category) => [category.id as string, category]));
  const taxRate = Number(orgRow?.sales_tax_rate ?? 0.0825);
  const timezone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const mayDiscount = canDiscountAtCheckout(staff);

  const { data: people } = await admin.from("staff").select("id").eq("organization_id", org).is("archived_at", null);
  const staffIds = new Set((people ?? []).map((row) => row.id as string));

  for (const line of input.lines) {
    const item = itemBy.get(line.itemId);
    if (!item || !item.active) return { error: "An item in the cart isn't for sale anymore." };
    if (!item.revenue_category_id) return { error: `${item.name} needs a revenue category before it can be sold.` };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999) return { error: "Check the quantities." };
    if (line.discount && line.discount.value > 0 && !mayDiscount) return { error: "Only Sales staff and Club Admins can give a discount." };
    const category = categoryBy.get(item.revenue_category_id as string);
    if (COMMISSIONABLE_CATEGORY_KEYS.includes(category?.key as string)) {
      const credits = line.credits ?? [];
      if (!line.none && credits.length === 0) return { error: `Choose who earns commission on ${item.name}, or None.` };
      const total = credits.reduce((sum, credit) => sum + credit.share, 0);
      if (credits.some((credit) => !staffIds.has(credit.staffId) || !(credit.share > 0)) || total > 100.001)
        return { error: `Check the commission on ${item.name}.` };
    }
  }

  const { promo, error: promoError } = input.promoCode
    ? await findPromo(admin, org, input.promoCode, timezone)
    : { promo: null, error: null };
  if (promoError) return { error: promoError };

  const cart = computeCart(
    input.lines.map((line, index) => {
      const item = itemBy.get(line.itemId)!;
      return {
        key: String(index),
        unitPriceCents: Number(item.price_cents),
        quantity: line.quantity,
        taxable: isTaxable(
          { taxable: (item.taxable as boolean | null) ?? null },
          categoryBy.get(item.revenue_category_id as string) as { taxable: boolean } | undefined,
        ),
        categoryId: item.revenue_category_id as string,
        manualDiscount: line.discount && line.discount.value > 0 ? line.discount : null,
      };
    }),
    taxRate,
    promo,
  );

  const { data: sale, error } = await admin
    .from("pos_sales")
    .insert({
      organization_id: org,
      status: "practice",
      mindbody_client_id: input.clientId,
      client_name: input.clientName?.slice(0, 200) ?? null,
      staff_id: staff.id,
      subtotal_cents: cart.subtotalCents,
      discount_cents: cart.discountCents,
      tax_cents: cart.taxCents,
      total_cents: cart.totalCents,
      tax_rate: taxRate,
      promo_code_id: promo?.id ?? null,
      promo_code: promo?.code ?? null,
      payment_method: "practice",
      note: input.note?.slice(0, 500) ?? null,
    })
    .select("id, sale_number")
    .single();
  if (error || !sale) return { error: "Couldn't save the sale. Try again." };

  const { error: lineError } = await admin.from("pos_sale_lines").insert(
    cart.lines.map((line, index) => {
      const request = input.lines[index];
      const item = itemBy.get(request.itemId)!;
      const category = categoryBy.get(item.revenue_category_id as string);
      const commissionable = COMMISSIONABLE_CATEGORY_KEYS.includes(category?.key as string);
      return {
        organization_id: org,
        sale_id: sale.id,
        pos_item_id: item.id,
        name: item.name,
        kind: item.kind,
        revenue_category_id: item.revenue_category_id,
        revenue_category: category?.name ?? null,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        discount_cents: line.manualDiscountCents + line.promoDiscountCents,
        taxable: line.taxable,
        tax_cents: line.taxCents,
        total_cents: line.totalCents,
        commission_credits: commissionable && !request.none ? (request.credits ?? []) : [],
        no_commission: commissionable ? Boolean(request.none) : false,
        line_number: index + 1,
      };
    }),
  );
  if (lineError) {
    await admin.from("pos_sales").delete().eq("id", sale.id);
    return { error: "Couldn't save the sale. Try again." };
  }
  if (promo) {
    const { data: current } = await admin.from("promo_codes").select("uses").eq("id", promo.id).maybeSingle();
    await admin
      .from("promo_codes")
      .update({ uses: Number(current?.uses ?? 0) + 1 })
      .eq("id", promo.id);
  }
  return { saleId: sale.id as string, saleNumber: Number(sale.sale_number) };
}
