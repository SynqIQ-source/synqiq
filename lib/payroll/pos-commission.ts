import { DateTime } from "luxon";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { frozenContracts } from "@/lib/memberships/freeze-check";
import { commissionForLine, planForPerson, type CommissionCategory, type CommissionPlan } from "@/lib/payroll/commission";
import { loadPlans } from "@/lib/payroll/commission-job";

// Commission on sales rung up at SynqIQ's POS, figured with the same plans
// and rules as Mindbody sales. While POS is in practice mode (the January
// parallel run) this is shown beside Mindbody's commission to compare; it is
// NOT written to commission_lines, so nobody is paid twice for one sale.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// POS revenue category -> commission category. Pilates sells as "other"
// (Mindbody's Pilates products earn nothing today); add an "Other" rule to a
// plan to pay on it.
const CATEGORY_BY_REVENUE_KEY: Record<string, CommissionCategory> = {
  membership_dues: "membership",
  registration_fee: "enrollment_fee",
  personal_training: "pt_package",
  pilates: "other",
};
export function commissionCategoryFor(revenueKey: string | null | undefined): CommissionCategory {
  if (!revenueKey) return "none";
  return CATEGORY_BY_REVENUE_KEY[revenueKey] ?? "retail";
}

export type PosCommissionInput = {
  lineId: string;
  saleId: string;
  saleNumber: number;
  saleAt: string;
  clientName: string | null;
  description: string;
  category: CommissionCategory;
  quantity: number;
  totalCents: number;
  taxCents: number;
  credits: { staffId: string; share: number }[];
  noCommission: boolean;
  frozenMember: boolean;
  isNewPtClient: boolean;
};
export type PosCommissionResult = {
  lineId: string;
  saleId: string;
  saleNumber: number;
  saleAt: string;
  clientName: string | null;
  description: string;
  staffId: string;
  sharePercent: number;
  baseCents: number;
  amountCents: number;
  rule: string; // "20%", "$25", "10% + $5"
};

type Person = { id: string; role: string; isTrainer: boolean };
type Setting = { planId: string | null; enabled: boolean | null };

// Pure: who earns what on each POS line. A membership sold at the POS is a
// new contract, unless the member was on freeze (should have been unfrozen).
export function posCommissions(
  lines: PosCommissionInput[],
  plans: CommissionPlan[],
  people: Map<string, Person>,
  settings: Map<string, Setting>,
): PosCommissionResult[] {
  const out: PosCommissionResult[] = [];
  for (const line of lines) {
    if (line.noCommission || line.category === "none" || line.totalCents <= 0) continue;
    const saleLine = {
      category: line.category,
      quantity: line.quantity,
      totalCents: line.totalCents,
      taxCents: line.taxCents,
      isNewMembership: (line.category === "membership" || line.category === "enrollment_fee") && !line.frozenMember,
      isNewPtClient: line.isNewPtClient,
      handoffApproved: false,
    };
    for (const credit of line.credits) {
      const person = people.get(credit.staffId);
      if (!person) continue;
      const assigned = planForPerson(person, settings.get(credit.staffId) ?? null, plans);
      if (!assigned?.enabled) continue;
      const result = commissionForLine(assigned.plan, saleLine);
      if (!result) continue;
      const amountCents = Math.round((result.amountCents * credit.share) / 100);
      if (amountCents <= 0) continue;
      const { percent, flatCents } = result.rule;
      out.push({
        lineId: line.lineId,
        saleId: line.saleId,
        saleNumber: line.saleNumber,
        saleAt: line.saleAt,
        clientName: line.clientName,
        description: line.description,
        staffId: credit.staffId,
        sharePercent: credit.share,
        baseCents: result.baseCents,
        amountCents,
        rule: [percent ? `${percent}%` : null, flatCents ? `$${(flatCents / 100).toFixed(2)}` : null].filter(Boolean).join(" + "),
      });
    }
  }
  return out;
}

// POS sales (not voided) in [fromIso, toIso) with commission figured.
export async function loadPosCommissions(admin: Admin, organizationId: string, fromIso: string, toIso: string) {
  const { data: sales } = await admin
    .from("pos_sales")
    .select("id, sale_number, created_at, mindbody_client_id, client_name, status")
    .eq("organization_id", organizationId)
    .neq("status", "voided")
    .gte("created_at", fromIso)
    .lt("created_at", toIso)
    .order("created_at")
    .limit(5000);
  if (!sales?.length) return { results: [] as PosCommissionResult[], saleCount: 0 };
  const saleIds = sales.map((sale) => sale.id as string);
  const clientIds = [...new Set(sales.map((sale) => sale.mindbody_client_id as string | null).filter((id): id is string => Boolean(id)))];
  const { data: org } = await admin
    .from("organizations")
    .select("commission_new_pt_months, crm_intro_session_type_id")
    .eq("id", organizationId)
    .maybeSingle();
  const months = Number(org?.commission_new_pt_months ?? 6);
  const introType = org?.crm_intro_session_type_id == null ? null : Number(org.crm_intro_session_type_id);
  const earliest = DateTime.fromISO(fromIso).minus({ months }).toISO()!;

  const [{ data: lines }, { data: categories }, plans, { data: people }, { data: settings }, appointments, frozen] = await Promise.all([
    admin
      .from("pos_sale_lines")
      .select("id, sale_id, name, revenue_category_id, quantity, tax_cents, total_cents, commission_credits, no_commission")
      .eq("organization_id", organizationId)
      .in("sale_id", saleIds),
    admin.from("revenue_categories").select("id, key").eq("organization_id", organizationId),
    loadPlans(admin, organizationId),
    admin.from("staff").select("id, role, is_trainer").eq("organization_id", organizationId),
    admin.from("staff_pay_settings").select("staff_id, commission_plan_id, commission_enabled").eq("organization_id", organizationId),
    clientIds.length
      ? admin
          .from("appointment_occurrences")
          .select("client_id, session_type_id, start_datetime")
          .eq("organization_id", organizationId)
          .in("client_id", clientIds)
          .gte("start_datetime", earliest)
          .lt("start_datetime", toIso)
          .in("status", ["Completed", "Arrived", "Confirmed", "Booked"])
          .limit(5000)
          .then((result) => result.data ?? [])
      : Promise.resolve([]),
    clientIds.length ? frozenContracts(admin, organizationId, clientIds) : Promise.resolve([]),
  ]);

  const keyBy = new Map((categories ?? []).map((row) => [row.id as string, row.key as string]));
  const saleBy = new Map(sales.map((sale) => [sale.id as string, sale]));
  const frozenClients = new Set(frozen.map((row) => row.clientId));
  const ptBy = new Map<string, number[]>();
  for (const appt of appointments) {
    if (introType != null && Number(appt.session_type_id) === introType) continue;
    const list = ptBy.get(appt.client_id as string) ?? [];
    list.push(Date.parse(appt.start_datetime as string));
    ptBy.set(appt.client_id as string, list);
  }
  const inputs: PosCommissionInput[] = (lines ?? []).map((line) => {
    const sale = saleBy.get(line.sale_id as string)!;
    const clientId = (sale.mindbody_client_id as string | null) ?? null;
    const saleAt = sale.created_at as string;
    const saleMs = Date.parse(saleAt);
    const windowStart = DateTime.fromMillis(saleMs).minus({ months }).toMillis();
    const category = commissionCategoryFor(keyBy.get(line.revenue_category_id as string));
    return {
      lineId: line.id as string,
      saleId: sale.id as string,
      saleNumber: Number(sale.sale_number),
      saleAt,
      clientName: (sale.client_name as string | null) ?? null,
      description: line.name as string,
      category,
      quantity: Number(line.quantity ?? 1),
      totalCents: Number(line.total_cents ?? 0),
      taxCents: Number(line.tax_cents ?? 0),
      credits: ((line.commission_credits as { staffId: string; share: number }[] | null) ?? []).map((credit) => ({
        staffId: String(credit.staffId),
        share: Number(credit.share ?? 100),
      })),
      noCommission: Boolean(line.no_commission),
      frozenMember: Boolean(clientId && frozenClients.has(clientId)),
      isNewPtClient: !clientId || !(ptBy.get(clientId) ?? []).some((at) => at >= windowStart && at < saleMs),
    };
  });
  const peopleBy = new Map(
    (people ?? []).map((row) => [row.id as string, { id: row.id as string, role: row.role as string, isTrainer: Boolean(row.is_trainer) }]),
  );
  const settingBy = new Map(
    (settings ?? []).map((row) => [
      row.staff_id as string,
      { planId: (row.commission_plan_id as string | null) ?? null, enabled: (row.commission_enabled as boolean | null) ?? null },
    ]),
  );
  return { results: posCommissions(inputs, plans, peopleBy, settingBy), saleCount: sales.length };
}
