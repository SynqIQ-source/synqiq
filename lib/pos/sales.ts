import { createSoldPacks } from "@/lib/sessions/packs";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canDiscountAtCheckout } from "@/lib/permissions";
import { computeCart, COMMISSIONABLE_CATEGORY_KEYS, needsBuyer, promoProblem, type PromoInput } from "@/lib/pos/cart";
import { isTaxable } from "@/lib/pos/catalog";
import { commissionEarnerIds } from "@/lib/payroll/commission-job";
import { expandCartLines, monthlySchedule, parsePackageParts, type PricedPart } from "@/lib/pos/packages";
import { firstPaymentParts, type BillingStart } from "@/lib/billing/renewals";
import type { CurrentStaff } from "@/lib/current-staff";
import {
  agreementsForSale,
  saveSignatures,
  signatureProblem,
  type AgreementSignatureRequest,
  type AgreementToSign,
} from "@/lib/agreements/sale";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type SaleLineRequest = {
  itemId: string;
  quantity: number;
  discount?: { kind: "percent" | "amount"; value: number } | null; // amount in cents
  priceCents?: number | null; // open-price items only (e.g. termination fee)
  credits?: { staffId: string; share: number }[];
  none?: boolean;
};

export type SalePayment = {
  livemode: boolean;
  paymentIntentId: string;
  amountCents: number; // what Stripe charged; must equal the recomputed total
  stripeAccountId: string;
  customerId: string | null;
  paymentMethodId: string | null;
  card?: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null;
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
// Items with an agreement (memberships, personal training) need the buyer's
// signature: `dryRun` checks the sale and returns the agreements to sign
// (filled in with this sale's items and prices); the real save needs a
// matching signature for each.
export async function savePracticeSale(
  staff: CurrentStaff,
  input: {
    clientId: string | null;
    clientName: string | null;
    lines: SaleLineRequest[];
    promoCode: string | null;
    note: string | null;
    agreements?: AgreementSignatureRequest[];
    evidence?: { ip: string | null; userAgent: string | null };
    dryRun?: boolean;
    // Card payments (lib/payments/checkout.ts): `validateOnly` checks the
    // whole sale, signatures included, and returns the amount to charge
    // without saving; `payment` saves the sale once Stripe has confirmed the
    // charge. A test-mode payment is saved as a practice sale so it never
    // counts in real reports.
    validateOnly?: boolean;
    payment?: SalePayment;
    // Memberships: bill monthly from the sign-up day (default), or prorate
    // the rest of this month and draft on the 1st (lib/billing/renewals.ts).
    billingStart?: BillingStart;
    // Bought online / in the member app (lib/online/buy.ts): no staff member,
    // no commission, no discounts. `staff` is then ONLINE_ACTOR.
    online?: boolean;
  },
): Promise<
  | { error: string }
  | { saleId: string; saleNumber: number }
  | { agreements: AgreementToSign[] }
  | { totalCents: number; recurring: boolean }
> {
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  if (input.lines.length === 0) return { error: "The cart is empty." };
  // Who's buying: a Mindbody client id, or "crm:<id>" for a CRM guest or lead
  // who isn't a Mindbody client yet (e.g. a guest buying their first membership).
  let mindbodyClientId = input.clientId;
  let crmContactId: string | null = null;
  if (input.clientId?.startsWith("crm:")) {
    const id = input.clientId.slice(4);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Pick the buyer again." };
    const { data: contact } = await admin
      .from("crm_contacts")
      .select("id, mindbody_client_id")
      .eq("id", id)
      .eq("organization_id", org)
      .is("deleted_at", null)
      .maybeSingle();
    if (!contact) return { error: "That guest wasn't found." };
    crmContactId = contact.id as string;
    mindbodyClientId = (contact.mindbody_client_id as string | null) ?? null;
  }
  if (input.lines.length > 100) return { error: "Too many lines." };
  const [{ data: orgRow }, { data: items }, { data: categories }] = await Promise.all([
    admin.from("organizations").select("sales_tax_rate, timezone").eq("id", org).maybeSingle(),
    admin
      .from("pos_items")
      .select(
        "id, name, kind, price_cents, revenue_category_id, taxable, active, package_parts, autopay_count, auto_renews, open_price, members_only, deleted_at, sessions, agreement_template_id",
      )
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
  const saleDate = DateTime.now().setZone(timezone).toISODate()!;
  const billingStart: BillingStart = input.billingStart === "prorated" ? "prorated" : "signup";
  const online = input.online === true;
  const mayDiscount = !online && canDiscountAtCheckout(staff);

  // Commission can only be credited to people who earn it (Admin > Commissions).
  const staffIds = await commissionEarnerIds(admin, org);
  // Online purchases: the buyer's assigned salesperson earns the commission
  // (Adam, 2026-11-19), when they earn commission; otherwise none.
  let onlineCredits: { staffId: string; share: number }[] = [];
  if (online && (crmContactId || mindbodyClientId)) {
    const lookup = admin.from("crm_contacts").select("assigned_staff_id").eq("organization_id", org).is("deleted_at", null);
    const { data: owner } = await (crmContactId ? lookup.eq("id", crmContactId) : lookup.eq("mindbody_client_id", mindbodyClientId!))
      .not("assigned_staff_id", "is", null)
      .limit(1);
    const assigned = (owner?.[0]?.assigned_staff_id as string | undefined) ?? null;
    if (assigned && staffIds.has(assigned)) onlineCredits = [{ staffId: assigned, share: 100 }];
  }

  const taxableFor = (categoryId: string) => Boolean(categoryBy.get(categoryId)?.taxable);
  // Package parts priced with their own category's tax.
  const partsBy = new Map<string, PricedPart[] | null>();
  for (const item of items ?? []) {
    const parts = item.kind === "membership" ? parsePackageParts(item.package_parts) : null;
    partsBy.set(item.id as string, parts?.length ? parts.map((part) => ({ ...part, taxable: taxableFor(part.revenueCategoryId) })) : null);
  }
  const isCommissionable = (itemId: string) => {
    const item = itemBy.get(itemId)!;
    const parts = partsBy.get(itemId);
    const keys = parts
      ? parts.map((part) => categoryBy.get(part.revenueCategoryId)?.key)
      : [categoryBy.get(item.revenue_category_id as string)?.key];
    return keys.some((key) => COMMISSIONABLE_CATEGORY_KEYS.includes(key as string));
  };

  for (const line of input.lines) {
    const item = itemBy.get(line.itemId);
    if (!item || !item.active || item.deleted_at) return { error: "An item in the cart isn't for sale anymore." };
    if (item.open_price) {
      const amount = Number(line.priceCents);
      if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) return { error: `Enter the amount for ${item.name}.` };
    }
    if (!item.revenue_category_id) return { error: `${item.name} needs a revenue category before it can be sold.` };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999) return { error: "Check the quantities." };
    if (line.discount && line.discount.value > 0 && !mayDiscount) return { error: "Only Sales staff and Club Admins can give a discount." };
    const lineParts = partsBy.get(item.id as string);
    const lineKeys = lineParts
      ? lineParts.map((part) => categoryBy.get(part.revenueCategoryId)?.key as string | undefined)
      : [categoryBy.get(item.revenue_category_id as string)?.key as string | undefined];
    if (!input.clientId && needsBuyer(item.kind as string, lineKeys))
      return { error: `Pick who ${item.name} is for (member, guest or lead).` };
    if (lineParts) {
      if (line.quantity !== 1) return { error: `Sell one ${item.name} at a time.` };
      if (!input.clientId) return { error: `Pick the member for ${item.name}.` };
    }
    if (isCommissionable(item.id as string) && !online) {
      const credits = line.credits ?? [];
      if (!line.none && credits.length === 0) return { error: `Choose who earns commission on ${item.name}, or None.` };
      const total = credits.reduce((sum, credit) => sum + credit.share, 0);
      if (credits.some((credit) => !staffIds.has(credit.staffId) || !(credit.share > 0)) || total > 100.001)
        return { error: `Check the commission on ${item.name}: only people who earn commission can be credited.` };
    }
  }

  const { promo, error: promoError } = input.promoCode
    ? await findPromo(admin, org, input.promoCode, timezone)
    : { promo: null, error: null };
  if (promoError) return { error: promoError };

  const expanded = expandCartLines(
    input.lines.map((line, index) => {
      const item = itemBy.get(line.itemId)!;
      const parts = partsBy.get(item.id as string);
      const firstParts = parts ? firstPaymentParts(parts, billingStart, saleDate) : null;
      return {
        key: String(index),
        quantity: line.quantity,
        manualDiscount: line.discount && line.discount.value > 0 ? line.discount : null,
        item: {
          priceCents: firstParts
            ? firstParts.reduce((sum, part) => sum + part.amountCents, 0)
            : item.open_price
              ? Number(line.priceCents)
              : Number(item.price_cents),
          taxable: isTaxable(
            { taxable: (item.taxable as boolean | null) ?? null },
            categoryBy.get(item.revenue_category_id as string) as { taxable: boolean } | undefined,
          ),
          categoryId: item.revenue_category_id as string,
          parts: firstParts,
        },
      };
    }),
  );
  // Members-only items (personal training, Pilates): the buyer needs an
  // active membership, or to be buying one in this sale.
  const membersOnly = input.lines.map((line) => itemBy.get(line.itemId)!).filter((item) => item.members_only);
  if (membersOnly.length) {
    const duesKey = new Set((categories ?? []).filter((row) => row.key === "membership_dues").map((row) => row.id as string));
    const joiningNow = input.lines.some((line) => {
      const parts = partsBy.get(line.itemId);
      return Boolean(parts?.some((part) => duesKey.has(part.revenueCategoryId)));
    });
    let member = false;
    if (mindbodyClientId) {
      const today = DateTime.now().setZone(timezone).toISODate()!;
      const { data: inForce } = await admin
        .from("member_contracts")
        .select("id")
        .eq("organization_id", org)
        .eq("mindbody_client_id", mindbodyClientId)
        .lte("start_date", today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .or(`termination_date.is.null,termination_date.gt.${today}`)
        .limit(1);
      member = Boolean(inForce?.length);
    }
    if (!member && !joiningNow) {
      const names = [...new Set(membersOnly.map((item) => item.name as string))].join(", ");
      return {
        error:
          mindbodyClientId || crmContactId
            ? `${names} ${membersOnly.length === 1 ? "is" : "are"} for members. This person has no active membership: add a membership to this sale, or remove it.`
            : `${names} ${membersOnly.length === 1 ? "is" : "are"} for members. Pick the member first.`,
      };
    }
  }

  const cart = computeCart(expanded, taxRate, promo);

  // Agreements the buyer signs for this sale.
  const toSign = await agreementsForSale(admin, org, {
    memberName: input.clientName,
    timezone,
    lines: input.lines.map((request, lineIndex) => {
      const item = itemBy.get(request.itemId)!;
      const parts = partsBy.get(item.id as string);
      const firstPaymentCents = cart.lines
        .filter((_line, index) => Number(expanded[index].parentKey) === lineIndex)
        .reduce((sum, line) => sum + line.netCents, 0);
      return {
        lineIndex,
        itemId: item.id as string,
        itemName: item.name as string,
        templateId: (item.agreement_template_id as string | null) ?? null,
        sessions: item.sessions == null ? null : Number(item.sessions),
        quantity: request.quantity,
        firstPaymentCents,
        monthlyDuesCents: parts
          ? (monthlySchedule(parts, taxRate, saleDate, billingStart)?.subtotalCents ?? null)
          : item.kind === "membership"
            ? Number(item.price_cents)
            : null,
      };
    }),
  });
  if (toSign.length && !input.clientName) return { error: `Pick the member first: ${toSign[0].itemName} needs their signature.` };
  if (input.dryRun) return { agreements: toSign };
  const unsigned = signatureProblem(toSign, input.agreements ?? []);
  if (unsigned) return { error: unsigned };
  const recurring = input.lines.some((request) => Boolean(partsBy.get(request.itemId)));
  if (input.validateOnly) return { totalCents: cart.totalCents, recurring };
  const payment = input.payment ?? null;
  if (payment && payment.amountCents !== cart.totalCents) return { error: "The total changed after the card was charged." };
  // Live card payment -> a real sale; anything else stays practice.
  const saleStatus = payment?.livemode ? "completed" : "practice";
  const scheduleStatus = payment?.livemode ? "active" : "practice";

  const { data: sale, error } = await admin
    .from("pos_sales")
    .insert({
      organization_id: org,
      status: saleStatus,
      mindbody_client_id: mindbodyClientId,
      crm_contact_id: crmContactId,
      client_name: input.clientName?.slice(0, 200) ?? null,
      staff_id: staff.id || null,
      source: online ? "online" : "pos",
      subtotal_cents: cart.subtotalCents,
      discount_cents: cart.discountCents,
      tax_cents: cart.taxCents,
      total_cents: cart.totalCents,
      tax_rate: taxRate,
      promo_code_id: promo?.id ?? null,
      promo_code: promo?.code ?? null,
      payment_method: payment ? (payment.livemode ? "card" : "card_test") : "practice",
      payment_ref: payment?.paymentIntentId ?? null,
      note: input.note?.slice(0, 500) ?? null,
    })
    .select("id, sale_number")
    .single();
  if (error || !sale) return { error: "Couldn't save the sale. Try again." };

  const { error: lineError } = await admin.from("pos_sale_lines").insert(
    cart.lines.map((line, index) => {
      const source = expanded[index];
      const request = input.lines[Number(source.parentKey)];
      const item = itemBy.get(request.itemId)!;
      const categoryId = (source.part?.revenueCategoryId ?? item.revenue_category_id) as string;
      const category = categoryBy.get(categoryId);
      const commissionable = COMMISSIONABLE_CATEGORY_KEYS.includes(category?.key as string);
      return {
        organization_id: org,
        sale_id: sale.id,
        pos_item_id: item.id,
        name: source.part ? `${item.name} · ${source.part.label}` : item.name,
        kind: item.kind,
        revenue_category_id: categoryId,
        revenue_category: category?.name ?? null,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        discount_cents: line.manualDiscountCents + line.promoDiscountCents,
        taxable: line.taxable,
        tax_cents: line.taxCents,
        total_cents: line.totalCents,
        commission_credits: !commissionable ? [] : online ? onlineCredits : !request.none ? (request.credits ?? []) : [],
        no_commission: commissionable ? (online ? onlineCredits.length === 0 : Boolean(request.none)) : false,
        package_item_id: source.part ? item.id : null,
        package_name: source.part ? item.name : null,
        recurring: source.part?.recurring ?? false,
        line_number: index + 1,
      };
    }),
  );
  if (lineError) {
    await admin.from("pos_sales").delete().eq("id", sale.id);
    return { error: "Couldn't save the sale. Try again." };
  }
  // Membership packages: the monthly payments that follow (dues only).
  const schedules = input.lines.flatMap((request) => {
    const item = itemBy.get(request.itemId)!;
    const parts = partsBy.get(item.id as string);
    const schedule = parts ? monthlySchedule(parts, taxRate, saleDate, billingStart) : null;
    if (!schedule || !input.clientId) return [];
    return [
      {
        organization_id: org,
        sale_id: sale.id,
        pos_item_id: item.id,
        mindbody_client_id: mindbodyClientId,
        crm_contact_id: crmContactId,
        client_name: input.clientName?.slice(0, 200) ?? null,
        name: item.name as string,
        status: scheduleStatus,
        start_date: saleDate,
        stripe_account_id: payment?.stripeAccountId ?? null,
        stripe_customer_id: payment?.customerId ?? null,
        stripe_payment_method_id: payment?.paymentMethodId ?? null,
        card_brand: payment?.card?.brand ?? null,
        card_last4: payment?.card?.last4 ?? null,
        card_exp_month: payment?.card?.expMonth ?? null,
        card_exp_year: payment?.card?.expYear ?? null,
        billing_start: billingStart,
        first_bill_date: schedule.firstBillDate,
        recurring_lines: schedule.lines.map((line) => ({ ...line, revenueCategory: categoryBy.get(line.revenueCategoryId)?.name ?? null })),
        recurring_subtotal_cents: schedule.subtotalCents,
        recurring_tax_cents: schedule.taxCents,
        recurring_total_cents: schedule.totalCents,
        autopay_count: item.autopay_count == null ? null : Number(item.autopay_count),
        auto_renews: Boolean(item.auto_renews),
      },
    ];
  });
  if (schedules.length) {
    const { error: scheduleError } = await admin.from("member_billing_schedules").insert(schedules);
    if (scheduleError) {
      await admin.from("pos_sales").delete().eq("id", sale.id);
      return { error: "Couldn't save the sale. Try again." };
    }
  }
  if (toSign.length) {
    try {
      await saveSignatures(
        admin,
        {
          organizationId: org,
          timezone,
          saleId: sale.id as string,
          saleNumber: Number(sale.sale_number),
          mindbodyClientId,
          crmContactId,
          clientName: input.clientName?.slice(0, 200) ?? null,
          staffId: staff.id || null,
          staffName: online ? "Online purchase" : (staff.displayName ?? null),
          ip: input.evidence?.ip ?? null,
          userAgent: input.evidence?.userAgent ?? null,
        },
        toSign,
        input.agreements ?? [],
      );
    } catch (signatureError) {
      console.error("pos sale: saving agreements failed", signatureError);
      await admin.from("member_billing_schedules").delete().eq("sale_id", sale.id);
      await admin.from("pos_sales").delete().eq("id", sale.id);
      return { error: "Couldn't save the signed agreement. Try again." };
    }
  }
  // Session packs sold (items with a session count) become the buyer's
  // SynqIQ balance. Live sales only: a practice sale gives no real sessions.
  if (payment?.livemode) {
    try {
      await createSoldPacks(admin, {
        organizationId: org,
        saleId: sale.id as string,
        mindbodyClientId,
        crmContactId,
        lines: input.lines.map((line) => {
          const item = itemBy.get(line.itemId)!;
          return {
            itemId: item.id as string,
            name: item.name as string,
            sessions: item.sessions == null ? null : Number(item.sessions),
            quantity: line.quantity,
            program: (categoryBy.get(item.revenue_category_id as string)?.name as string | undefined) ?? null,
          };
        }),
      });
    } catch (packError) {
      console.error("pos sale: session packs not created", packError);
    }
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

// Who may void a sale: Club Admins and Sales Leads any sale; the person who
// rang it up, within 12 hours (a same-shift mistake).
export function canVoidSale(staff: { id: string; role: string }, sale: { staffId: string; createdAt: string }, now: Date): boolean {
  if (staff.role === "admin" || staff.role === "sales_lead") return true;
  return staff.id === sale.staffId && now.getTime() - Date.parse(sale.createdAt) < 12 * 3_600_000;
}

export type SummaryLine = { revenueCategory: string | null; totalCents: number; taxCents: number; discountCents: number };
export type SummarySale = { status: string; paymentMethod: string; staffName: string; totalCents: number; lines: SummaryLine[] };

// End-of-day totals (voided sales left out): by payment method, by revenue
// category (before tax) and by who rang it up.
export function endOfDaySummary(sales: SummarySale[]) {
  const counted = sales.filter((sale) => sale.status !== "voided");
  const add = (map: Map<string, { count: number; cents: number }>, key: string, cents: number) => {
    const entry = map.get(key) ?? { count: 0, cents: 0 };
    entry.count += 1;
    entry.cents += cents;
    map.set(key, entry);
  };
  const byPayment = new Map<string, { count: number; cents: number }>();
  const byStaff = new Map<string, { count: number; cents: number }>();
  const byCategory = new Map<string, { count: number; cents: number }>();
  let taxCents = 0;
  let discountCents = 0;
  for (const sale of counted) {
    add(byPayment, sale.paymentMethod, sale.totalCents);
    add(byStaff, sale.staffName, sale.totalCents);
    for (const line of sale.lines) {
      add(byCategory, line.revenueCategory ?? "Uncategorized", line.totalCents - line.taxCents);
      taxCents += line.taxCents;
      discountCents += line.discountCents;
    }
  }
  const sorted = (map: Map<string, { count: number; cents: number }>) =>
    [...map.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.cents - a.cents);
  return {
    sales: counted.length,
    voided: sales.length - counted.length,
    totalCents: counted.reduce((sum, sale) => sum + sale.totalCents, 0),
    taxCents,
    discountCents,
    byPayment: sorted(byPayment),
    byCategory: sorted(byCategory),
    byStaff: sorted(byStaff),
  };
}
