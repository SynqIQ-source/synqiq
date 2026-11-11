import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin, ROLE_LABELS, type StaffRole } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { planForPerson } from "@/lib/payroll/commission";
import { loadPlans, loadSaleLines } from "@/lib/payroll/commission-job";
import { resolveRange } from "@/lib/time-clock/timesheet";
import { CommissionsEditor, type CommissionLineRow, type HandoffRow, type PersonRow, type ProductRow } from "./commissions-editor";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

// Club Admin: commission on pre-tax sale amounts. What each product counts as,
// the plans and their rules, who is on which plan, trainer handoffs to
// approve, and the commission earned in a date range.
export default async function CommissionsPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const { data: orgRow } = await admin.from("organizations").select("timezone, commission_new_pt_months").eq("id", org).maybeSingle();
  const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const { from, to } = resolveRange(await searchParams, zone);
  const fromIso = DateTime.fromISO(from, { zone }).startOf("day").toUTC().toISO()!;
  const toIso = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!;

  const [plans, people, settings, products, lines, saleLines] = await Promise.all([
    loadPlans(admin, org),
    admin
      .from("staff")
      .select("id, display_name, role, is_trainer, can_sell, archived_at")
      .eq("organization_id", org)
      .order("display_name"),
    admin.from("staff_pay_settings").select("staff_id, commission_plan_id, commission_enabled").eq("organization_id", org),
    admin.from("commission_items").select("product_id, name, category").eq("organization_id", org).order("name"),
    admin
      .from("commission_lines")
      .select(
        "id, staff_id, kind, mindbody_sale_detail_id, sale_at, earned_at, description, category, condition, base_cents, percent, flat_cents, amount_cents",
      )
      .eq("organization_id", org)
      .gte("earned_at", fromIso)
      .lt("earned_at", toIso)
      .order("earned_at", { ascending: false })
      .limit(2000),
    loadSaleLines(admin, org, fromIso, toIso),
  ]);

  const nameOf = new Map((people.data ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const settingBy = new Map((settings.data ?? []).map((row) => [row.staff_id as string, row]));
  const personRows: PersonRow[] = (people.data ?? [])
    .filter((row) => !row.archived_at)
    .map((row) => {
      const setting = settingBy.get(row.id as string);
      const effective = planForPerson(
        { role: row.role as string, isTrainer: Boolean(row.is_trainer) },
        setting
          ? {
              planId: (setting.commission_plan_id as string | null) ?? null,
              enabled: (setting.commission_enabled as boolean | null) ?? null,
            }
          : null,
        plans,
      );
      return {
        id: row.id as string,
        name: (row.display_name as string | null) ?? "Unknown",
        role: ROLE_LABELS[row.role as StaffRole] ?? "Staff",
        trainer: Boolean(row.is_trainer),
        planId: (setting?.commission_plan_id as string | null) ?? "",
        enabled: setting?.commission_enabled == null ? "default" : setting.commission_enabled ? "on" : "off",
        effective: effective ? `${effective.plan.name}${effective.enabled ? "" : " (off)"}` : "No commission",
      };
    });
  const lineRows: CommissionLineRow[] = (lines.data ?? []).map((row) => ({
    id: row.id as string,
    staffName: nameOf.get(row.staff_id as string) ?? "Unknown",
    kind: row.kind as "earn" | "clawback",
    saleAt: row.sale_at as string,
    description: row.description as string,
    condition: row.condition as string,
    baseCents: Number(row.base_cents),
    percent: row.percent == null ? null : Number(row.percent),
    flatCents: row.flat_cents == null ? null : Number(row.flat_cents),
    amountCents: Number(row.amount_cents),
  }));
  // PT packages a trainer sold: candidates for a handoff commission.
  const handoffs: HandoffRow[] = saleLines
    .filter((line) => line.category === "pt_package" && line.sellerIsTrainer && line.totalCents > 0 && !line.returned)
    .map((line) => ({
      detailId: line.detailId,
      saleAt: line.saleAt,
      description: line.description,
      seller: line.sellerName ?? "Unknown",
      preTaxCents: Math.max(0, line.totalCents - line.taxCents),
      approved: line.handoffApproved,
      hint:
        line.clientTrainerStaffId && line.clientTrainerStaffId !== line.sellerStaffId
          ? `Client's trainer: ${nameOf.get(line.clientTrainerStaffId) ?? "another trainer"}`
          : line.clientTrainerStaffId
            ? "Client's trainer is the seller"
            : "",
    }));
  const productRows: ProductRow[] = (products.data ?? []).map((row) => ({
    productId: Number(row.product_id),
    name: row.name as string,
    category: row.category as ProductRow["category"],
  }));

  return (
    <DashboardShell
      title="Commissions"
      description="Commission is figured on the pre-tax price of each sale line, never on tax. Set what each product counts as, the plans, and who is on which plan."
    >
      <CommissionsEditor
        from={from}
        to={to}
        timezone={zone}
        ptMonths={Number(orgRow?.commission_new_pt_months ?? 6)}
        plans={plans}
        people={personRows}
        products={productRows}
        lines={lineRows}
        handoffs={handoffs}
      />
    </DashboardShell>
  );
}
