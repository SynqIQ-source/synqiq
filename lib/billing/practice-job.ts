import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { billingDatesThrough, matchPracticeCharge, scheduleFromContract, type MindbodyCharge } from "@/lib/billing/practice";

// Billing test runner (see lib/billing/practice.ts). For each test member:
// import their active Mindbody autopay contracts into SynqIQ schedules (once),
// record a practice charge for every billing date up to today, and check
// each against the Mindbody charges synced from Mindbody's sales. Reads
// Mindbody's data only; never charges anyone.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function importMindbodySchedules(admin: Admin, organizationId: string, clientId: string, taxRate: number) {
  const { data: contracts } = await admin
    .from("member_contracts")
    .select(
      "mindbody_client_contract_id, contract_name, start_date, end_date, autopay_status, auto_renewing, normal_autopay_cents, next_bill_subtotal_cents, next_bill_tax_cents, termination_date",
    )
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId)
    .eq("autopay_status", "Active");
  let imported = 0;
  for (const contract of contracts ?? []) {
    if (contract.termination_date || !(Number(contract.normal_autopay_cents) > 0)) continue; // $0 add-ons (pool lanes) aren't billing
    const schedule = scheduleFromContract(
      {
        startDate: (contract.start_date as string | null) ?? null,
        endDate: (contract.end_date as string | null) ?? null,
        autoRenewing: Boolean(contract.auto_renewing),
        normalCents: Number(contract.normal_autopay_cents),
        nextSubtotalCents: contract.next_bill_subtotal_cents == null ? null : Number(contract.next_bill_subtotal_cents),
        nextTaxCents: contract.next_bill_tax_cents == null ? null : Number(contract.next_bill_tax_cents),
      },
      taxRate,
    );
    if (!schedule) continue;
    // Imported once; SynqIQ works out the dates from then on.
    const { data: existing } = await admin
      .from("member_billing_schedules")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source", "mindbody")
      .eq("mindbody_client_contract_id", Number(contract.mindbody_client_contract_id))
      .maybeSingle();
    if (existing) continue;
    const { error } = await admin.from("member_billing_schedules").insert({
      organization_id: organizationId,
      source: "mindbody",
      mindbody_client_contract_id: Number(contract.mindbody_client_contract_id),
      mindbody_client_id: clientId,
      name: contract.contract_name,
      status: "practice",
      start_date: contract.start_date,
      end_date: contract.end_date,
      first_bill_date: schedule.firstBillDate,
      recurring_lines: [{ label: "Monthly dues", amountCents: schedule.subtotalCents, taxable: schedule.taxCents > 0 }],
      recurring_subtotal_cents: schedule.subtotalCents,
      recurring_tax_cents: schedule.taxCents,
      recurring_total_cents: schedule.totalCents,
      autopay_count: schedule.autopayCount,
      auto_renews: schedule.autoRenews,
    });
    if (error) throw new Error(error.message);
    imported += 1;
  }
  return imported;
}

export async function runPracticeBilling(organizationId: string, options: { clientIds?: string[] } = {}) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone, sales_tax_rate").eq("id", organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const taxRate = Number(org?.sales_tax_rate ?? 0.0825);
  const today = DateTime.now().setZone(zone).toISODate()!;
  let clientIds = options.clientIds;
  if (!clientIds) {
    const { data } = await admin.from("billing_test_members").select("mindbody_client_id").eq("organization_id", organizationId);
    clientIds = (data ?? []).map((row) => row.mindbody_client_id as string);
  }
  const summary = { members: clientIds.length, schedules: 0, recorded: 0, checked: 0 };
  for (const clientId of clientIds) {
    await importMindbodySchedules(admin, organizationId, clientId, taxRate);
    const { data: schedules } = await admin
      .from("member_billing_schedules")
      .select(
        "id, name, first_bill_date, autopay_count, auto_renews, recurring_subtotal_cents, recurring_tax_cents, recurring_total_cents, mindbody_client_contract_id",
      )
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .eq("source", "mindbody")
      .eq("status", "practice");
    summary.schedules += schedules?.length ?? 0;

    // Record a practice charge on every billing date so far.
    for (const schedule of schedules ?? []) {
      const dates = billingDatesThrough(
        String(schedule.first_bill_date),
        schedule.autopay_count == null ? null : Number(schedule.autopay_count),
        Boolean(schedule.auto_renews),
        today,
      );
      if (!dates.length) continue;
      const { data: saved } = await admin
        .from("practice_charges")
        .upsert(
          dates.map((due) => ({
            organization_id: organizationId,
            schedule_id: schedule.id,
            mindbody_client_id: clientId,
            due_date: due,
            subtotal_cents: Number(schedule.recurring_subtotal_cents),
            tax_cents: Number(schedule.recurring_tax_cents),
            total_cents: Number(schedule.recurring_total_cents),
          })),
          { onConflict: "schedule_id,due_date", ignoreDuplicates: true },
        )
        .select("id");
      summary.recorded += saved?.length ?? 0;
    }

    // Check the open ones against Mindbody's charges for this member.
    const { data: open } = await admin
      .from("practice_charges")
      .select("id, schedule_id, due_date, total_cents, result, mindbody_sale_detail_id")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .order("due_date");
    const since = DateTime.fromISO(String(open?.[0]?.due_date ?? today))
      .minus({ days: 5 })
      .toUTC()
      .toISO()!;
    const { data: sales } = await admin
      .from("member_sales")
      .select("mindbody_sale_id, sale_at")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", clientId)
      .gte("sale_at", since);
    const saleDay = new Map(
      (sales ?? []).map((sale) => [
        Number(sale.mindbody_sale_id),
        DateTime.fromISO(sale.sale_at as string)
          .setZone(zone)
          .toISODate()!,
      ]),
    );
    const { data: items } = saleDay.size
      ? await admin
          .from("member_sale_items")
          .select("mindbody_sale_id, mindbody_sale_detail_id, description, contract_id, total_cents, returned")
          .eq("organization_id", organizationId)
          .in("mindbody_sale_id", [...saleDay.keys()])
      : { data: [] };
    const mindbody: MindbodyCharge[] = (items ?? [])
      .filter((item) => !item.returned && Number(item.total_cents) > 0)
      .map((item) => ({
        detailId: Number(item.mindbody_sale_detail_id),
        day: saleDay.get(Number(item.mindbody_sale_id)) ?? "",
        totalCents: Number(item.total_cents),
        description: item.description as string,
        contractId: item.contract_id == null ? null : Number(item.contract_id),
      }));
    const scheduleBy = new Map((schedules ?? []).map((row) => [row.id as string, row]));
    const taken = new Set(
      (open ?? [])
        .filter((row) => row.mindbody_sale_detail_id != null && row.result !== "pending")
        .map((row) => Number(row.mindbody_sale_detail_id)),
    );
    for (const charge of open ?? []) {
      if (charge.result !== "pending" && charge.result !== "not_charged") continue;
      const schedule = scheduleBy.get(charge.schedule_id as string);
      if (!schedule) continue;
      const { result, match } = matchPracticeCharge(
        {
          dueDate: String(charge.due_date),
          totalCents: Number(charge.total_cents),
          contractIds: schedule.mindbody_client_contract_id == null ? [] : [Number(schedule.mindbody_client_contract_id)],
          name: schedule.name as string,
        },
        mindbody,
        today,
        taken,
      );
      if (match) taken.add(match.detailId);
      await admin
        .from("practice_charges")
        .update({
          result,
          mindbody_sale_detail_id: match?.detailId ?? null,
          mindbody_total_cents: match?.totalCents ?? null,
          mindbody_charged_on: match?.day ?? null,
          checked_at: new Date().toISOString(),
        })
        .eq("id", charge.id);
      summary.checked += 1;
    }
  }
  return summary;
}
