import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  commissionForLine,
  guessCategory,
  planForPerson,
  type CommissionCategory,
  type CommissionPlan,
  type CommissionRule,
} from "@/lib/payroll/commission";

// Figures commission for sales in a date range from the synced Mindbody sale
// lines (member_sales / member_sale_items, read-only) and writes the snapshot
// to commission_lines. Safe to run again: an existing earn line is never
// rewritten (later rate changes don't change past pay); a handoff a Club
// Admin un-approves is removed; a returned line gets a negative clawback.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export type CommissionSaleLine = {
  saleId: number;
  detailId: number;
  clientId: string;
  saleAt: string;
  description: string;
  productId: number | null;
  quantity: number;
  totalCents: number;
  taxCents: number;
  returned: boolean;
  category: CommissionCategory;
  sellerStaffId: string | null;
  sellerName: string | null;
  sellerIsTrainer: boolean;
  isNewMembership: boolean;
  isNewPtClient: boolean;
  handoffApproved: boolean;
  clientTrainerStaffId: string | null; // trainer of record (CRM onboarding), for the handoff hint
};

export async function loadPlans(admin: Admin, organizationId: string): Promise<CommissionPlan[]> {
  const [{ data: plans }, { data: rules }] = await Promise.all([
    admin.from("commission_plans").select("*").eq("organization_id", organizationId).is("archived_at", null).order("name"),
    admin.from("commission_rules").select("*").eq("organization_id", organizationId),
  ]);
  return (plans ?? []).map((plan) => ({
    id: plan.id as string,
    name: plan.name as string,
    defaultRoles: (plan.default_roles as string[] | null) ?? [],
    defaultTrainers: Boolean(plan.default_trainers),
    defaultEnabled: Boolean(plan.default_enabled),
    earnOn: plan.earn_on as "sale" | "payment",
    rules: (rules ?? [])
      .filter((rule) => rule.plan_id === plan.id)
      .map((rule) => ({
        id: rule.id as string,
        planId: rule.plan_id as string,
        category: rule.category as CommissionRule["category"],
        condition: rule.condition as CommissionRule["condition"],
        percent: rule.percent == null ? null : Number(rule.percent),
        flatCents: rule.flat_cents == null ? null : Number(rule.flat_cents),
      })),
  }));
}

// Sale lines in [fromIso, toIso) with everything the rules need.
export async function loadSaleLines(admin: Admin, organizationId: string, fromIso: string, toIso: string): Promise<CommissionSaleLine[]> {
  const [{ data: org }, sales] = await Promise.all([
    admin
      .from("organizations")
      .select("timezone, commission_new_pt_months, crm_intro_session_type_id")
      .eq("id", organizationId)
      .maybeSingle(),
    all((from, to) =>
      admin
        .from("member_sales")
        .select("mindbody_sale_id, mindbody_client_id, sale_at, sales_rep_mindbody_id")
        .eq("organization_id", organizationId)
        .gte("sale_at", fromIso)
        .lt("sale_at", toIso)
        .order("mindbody_sale_id")
        .range(from, to),
    ),
  ]);
  if (sales.length === 0) return [];
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const months = Number(org?.commission_new_pt_months ?? 6);
  const introType = org?.crm_intro_session_type_id == null ? null : Number(org.crm_intro_session_type_id);
  const saleIds = sales.map((sale) => sale.mindbody_sale_id as number);
  const clientIds = [...new Set(sales.map((sale) => sale.mindbody_client_id as string))];

  const chunks = <T>(list: T[], size = 300) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
  const items = (
    await Promise.all(
      chunks(saleIds).map((ids) =>
        all((from, to) =>
          admin
            .from("member_sale_items")
            .select(
              "mindbody_sale_id, mindbody_sale_detail_id, description, product_id, contract_id, quantity, total_cents, tax_cents, returned",
            )
            .eq("organization_id", organizationId)
            .in("mindbody_sale_id", ids)
            .order("mindbody_sale_detail_id")
            .range(from, to),
        ),
      ),
    )
  ).flat();
  const contractIds = [...new Set(items.map((item) => item.contract_id).filter((id) => id != null))] as number[];
  const productIds = [...new Set(items.map((item) => item.product_id).filter((id) => id != null))] as number[];
  const earliest = DateTime.fromISO(fromIso).minus({ months }).toISO()!;

  const [staff, categories, contracts, flags, appointments, contacts] = await Promise.all([
    all((from, to) =>
      admin
        .from("staff")
        .select("id, display_name, mindbody_staff_id, is_trainer")
        .eq("organization_id", organizationId)
        .order("id")
        .range(from, to),
    ),
    productIds.length
      ? all((from, to) =>
          admin
            .from("commission_items")
            .select("product_id, category")
            .eq("organization_id", organizationId)
            .order("product_id")
            .range(from, to),
        )
      : Promise.resolve([]),
    Promise.all(
      chunks(contractIds).map((ids) =>
        admin
          .from("member_contracts")
          .select("mindbody_client_contract_id, agreement_date, renewed_from_client_contract_id")
          .eq("organization_id", organizationId)
          .in("mindbody_client_contract_id", ids),
      ),
    ).then((results) => results.flatMap((result) => result.data ?? [])),
    all((from, to) =>
      admin
        .from("commission_sale_flags")
        .select("mindbody_sale_detail_id, handoff_approved")
        .eq("organization_id", organizationId)
        .order("mindbody_sale_detail_id")
        .range(from, to),
    ),
    Promise.all(
      chunks(clientIds).map((ids) =>
        all((from, to) =>
          admin
            .from("appointment_occurrences")
            .select("client_id, session_type_id, status, start_datetime")
            .eq("organization_id", organizationId)
            .in("client_id", ids)
            .gte("start_datetime", earliest)
            .lt("start_datetime", toIso)
            .in("status", ["Completed", "Arrived", "Confirmed", "Booked"])
            .order("start_datetime")
            .range(from, to),
        ),
      ),
    ).then((results) => results.flat()),
    Promise.all(
      chunks(clientIds).map((ids) =>
        admin
          .from("crm_contacts")
          .select("mindbody_client_id, trainer_staff_id")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .in("mindbody_client_id", ids),
      ),
    ).then((results) => results.flatMap((result) => result.data ?? [])),
  ]);

  // Remember products we haven't categorized yet, with a first guess.
  const known = new Map(categories.map((row) => [Number(row.product_id), row.category as CommissionCategory]));
  const fresh = new Map<number, { name: string; hasContract: boolean }>();
  for (const item of items) {
    const id = item.product_id == null ? null : Number(item.product_id);
    if (id == null || known.has(id) || fresh.has(id)) continue;
    fresh.set(id, { name: item.description as string, hasContract: item.contract_id != null });
  }
  if (fresh.size) {
    const rows = [...fresh.entries()].map(([productId, info]) => ({
      organization_id: organizationId,
      product_id: productId,
      name: info.name,
      category: guessCategory(info.name, info.hasContract),
    }));
    await admin.from("commission_items").upsert(rows, { onConflict: "organization_id,product_id", ignoreDuplicates: true });
    rows.forEach((row) => known.set(row.product_id, row.category));
  }

  const staffByMindbody = new Map(staff.map((row) => [Number(row.mindbody_staff_id), row]));
  const contractBy = new Map(contracts.map((row) => [Number(row.mindbody_client_contract_id), row]));
  const flagBy = new Map(flags.map((row) => [Number(row.mindbody_sale_detail_id), Boolean(row.handoff_approved)]));
  const trainerBy = new Map(contacts.map((row) => [row.mindbody_client_id as string, (row.trainer_staff_id as string | null) ?? null]));
  const ptBy = new Map<string, number[]>();
  for (const appt of appointments) {
    if (introType != null && Number(appt.session_type_id) === introType) continue;
    const list = ptBy.get(appt.client_id as string) ?? [];
    list.push(Date.parse(appt.start_datetime as string));
    ptBy.set(appt.client_id as string, list);
  }
  const saleBy = new Map(sales.map((sale) => [Number(sale.mindbody_sale_id), sale]));

  return items.map((item) => {
    const sale = saleBy.get(Number(item.mindbody_sale_id))!;
    const saleAt = sale.sale_at as string;
    const saleMs = Date.parse(saleAt);
    const seller = sale.sales_rep_mindbody_id == null ? undefined : staffByMindbody.get(Number(sale.sales_rep_mindbody_id));
    const category = item.product_id == null ? "none" : (known.get(Number(item.product_id)) ?? "none");
    const contract = item.contract_id == null ? undefined : contractBy.get(Number(item.contract_id));
    const saleDay = DateTime.fromISO(saleAt).setZone(timezone).toISODate();
    const isNewMembership =
      category === "enrollment_fee" ||
      (Boolean(contract) && contract!.agreement_date === saleDay && contract!.renewed_from_client_contract_id == null);
    const windowStart = DateTime.fromMillis(saleMs).minus({ months }).toMillis();
    const recentPt = (ptBy.get(sale.mindbody_client_id as string) ?? []).some((at) => at >= windowStart && at < saleMs);
    return {
      saleId: Number(item.mindbody_sale_id),
      detailId: Number(item.mindbody_sale_detail_id),
      clientId: sale.mindbody_client_id as string,
      saleAt,
      description: item.description as string,
      productId: item.product_id == null ? null : Number(item.product_id),
      quantity: Number(item.quantity ?? 1),
      totalCents: Number(item.total_cents ?? 0),
      taxCents: Number(item.tax_cents ?? 0),
      returned: Boolean(item.returned),
      category,
      sellerStaffId: (seller?.id as string | undefined) ?? null,
      sellerName: (seller?.display_name as string | undefined) ?? null,
      sellerIsTrainer: Boolean(seller?.is_trainer),
      isNewMembership,
      isNewPtClient: !recentPt,
      handoffApproved: flagBy.get(Number(item.mindbody_sale_detail_id)) ?? false,
      clientTrainerStaffId: trainerBy.get(sale.mindbody_client_id as string) ?? null,
    };
  });
}

export async function computeCommissions(organizationId: string, fromIso: string, toIso: string) {
  const admin = createSupabaseAdminClient();
  const [lines, plans, people, settings] = await Promise.all([
    loadSaleLines(admin, organizationId, fromIso, toIso),
    loadPlans(admin, organizationId),
    admin.from("staff").select("id, role, is_trainer").eq("organization_id", organizationId),
    admin.from("staff_pay_settings").select("staff_id, commission_plan_id, commission_enabled").eq("organization_id", organizationId),
  ]);
  const personBy = new Map((people.data ?? []).map((row) => [row.id as string, row]));
  const settingBy = new Map((settings.data ?? []).map((row) => [row.staff_id as string, row]));

  const earn: Record<string, unknown>[] = [];
  const shouldExist = new Set<string>(); // detailId|staffId of earn lines that still qualify
  for (const line of lines) {
    if (!line.sellerStaffId || line.category === "none" || line.totalCents <= 0 || line.returned) continue;
    const person = personBy.get(line.sellerStaffId);
    if (!person) continue;
    const setting = settingBy.get(line.sellerStaffId);
    const assigned = planForPerson(
      { role: person.role as string, isTrainer: Boolean(person.is_trainer) },
      setting
        ? { planId: (setting.commission_plan_id as string | null) ?? null, enabled: (setting.commission_enabled as boolean | null) ?? null }
        : null,
      plans,
    );
    if (!assigned?.enabled) continue;
    const result = commissionForLine(assigned.plan, line);
    if (!result) continue;
    shouldExist.add(`${line.detailId}|${line.sellerStaffId}`);
    earn.push({
      organization_id: organizationId,
      staff_id: line.sellerStaffId,
      kind: "earn",
      mindbody_sale_id: line.saleId,
      mindbody_sale_detail_id: line.detailId,
      mindbody_client_id: line.clientId,
      sale_at: line.saleAt,
      earned_at: line.saleAt,
      description: line.description,
      category: line.category,
      condition: result.rule.condition,
      plan_id: assigned.plan.id,
      rule_id: result.rule.id,
      quantity: line.quantity,
      base_cents: result.baseCents,
      percent: result.rule.percent,
      flat_cents: result.rule.flatCents,
      amount_cents: result.amountCents,
    });
  }
  if (earn.length) {
    const { error } = await admin
      .from("commission_lines")
      .upsert(earn, { onConflict: "organization_id,mindbody_sale_detail_id,staff_id,kind", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  // Existing earn lines in range: drop un-approved handoffs, claw back returns.
  const existing = await all((from, to) =>
    admin
      .from("commission_lines")
      .select(
        "id, staff_id, kind, mindbody_sale_id, mindbody_sale_detail_id, mindbody_client_id, sale_at, description, category, condition, plan_id, rule_id, quantity, base_cents, percent, flat_cents, amount_cents",
      )
      .eq("organization_id", organizationId)
      .gte("sale_at", fromIso)
      .lt("sale_at", toIso)
      .order("id")
      .range(from, to),
  );
  const lineBy = new Map(lines.map((line) => [line.detailId, line]));
  const clawed = new Set(existing.filter((row) => row.kind === "clawback").map((row) => `${row.mindbody_sale_detail_id}|${row.staff_id}`));
  const removeIds: string[] = [];
  const clawbacks: Record<string, unknown>[] = [];
  for (const row of existing) {
    if (row.kind !== "earn") continue;
    const key = `${row.mindbody_sale_detail_id}|${row.staff_id}`;
    const line = lineBy.get(Number(row.mindbody_sale_detail_id));
    if (row.condition === "handoff" && !shouldExist.has(key) && !line?.returned) {
      removeIds.push(row.id as string);
      continue;
    }
    if (line?.returned && !clawed.has(key)) {
      clawbacks.push({
        ...Object.fromEntries(Object.entries(row).filter(([field]) => field !== "id")),
        organization_id: organizationId,
        kind: "clawback",
        earned_at: new Date().toISOString(),
        amount_cents: -Number(row.amount_cents),
      });
    }
  }
  if (removeIds.length) await admin.from("commission_lines").delete().in("id", removeIds);
  if (clawbacks.length) {
    const { error } = await admin
      .from("commission_lines")
      .upsert(clawbacks, { onConflict: "organization_id,mindbody_sale_detail_id,staff_id,kind", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { saleLines: lines.length, earned: earn.length, removed: removeIds.length, clawbacks: clawbacks.length };
}
