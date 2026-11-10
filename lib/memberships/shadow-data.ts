import { DateTime } from "luxon";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";
import {
  compareCharges,
  expectedCharges,
  summarize,
  type BillingAdjustment,
  type ComparisonLine,
  type ContractSchedule,
  type ReportLine,
} from "@/lib/memberships/shadow-billing";
import { loadScheduledIncreases } from "@/lib/memberships/price-increase-data";

// Loads everything shadow billing needs for one studio (through the Club
// Admin's own RLS-scoped client) and runs the comparison.

const PAGE = 1000;

async function pages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await run(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export type ShadowBillingResult = {
  window: { from: string; to: string } | null;
  lines: ComparisonLine[];
  summary: ReturnType<typeof summarize>;
  adjustments: (BillingAdjustment & { createdAt: string })[];
  namesByClientId: Map<string, string>;
  contractsSyncedAt: string | null;
  reportUploadedAt: string | null;
  reportRange: { from: string; to: string } | null;
};

export async function loadShadowBilling(
  supabase: ScopedSupabaseClient,
  organizationId: string,
  timezone: string,
): Promise<ShadowBillingResult> {
  type ContractRow = {
    id: string;
    mindbody_client_id: string;
    payer_mindbody_client_id: string | null;
    contract_name: string;
    autopay_status: string | null;
    upcoming_autopays: ContractSchedule["autopays"];
    synced_at: string;
  };
  type AutopayRow = {
    mindbody_client_id: string | null;
    client_name: string;
    charge_date: string;
    amount_cents: number;
    status: ReportLine["status"];
  };
  type AdjustmentRow = {
    id: string;
    mindbody_client_id: string;
    member_contract_id: string | null;
    kind: BillingAdjustment["kind"];
    amount_cents: number | null;
    percent: number | null;
    starts_on: string;
    ends_on: string | null;
    reason: string;
    created_at: string;
  };

  const [contracts, report, adjustmentRows, { data: lastImport }, increases] = await Promise.all([
    pages<ContractRow>((from, to) =>
      supabase
        .from("member_contracts")
        .select("id, mindbody_client_id, payer_mindbody_client_id, contract_name, autopay_status, upcoming_autopays, synced_at")
        .eq("organization_id", organizationId)
        .order("id")
        .range(from, to)
        .returns<ContractRow[]>(),
    ),
    pages<AutopayRow>((from, to) =>
      supabase
        .from("mbo_autopay_rows")
        .select("mindbody_client_id, client_name, charge_date, amount_cents, status")
        .eq("organization_id", organizationId)
        .order("id")
        .range(from, to)
        .returns<AutopayRow[]>(),
    ),
    pages<AdjustmentRow>((from, to) =>
      supabase
        .from("billing_adjustments")
        .select("id, mindbody_client_id, member_contract_id, kind, amount_cents, percent, starts_on, ends_on, reason, created_at")
        .eq("organization_id", organizationId)
        .is("cancelled_at", null)
        .order("created_at")
        .range(from, to)
        .returns<AdjustmentRow[]>(),
    ),
    supabase
      .from("report_imports")
      .select("created_at")
      .eq("organization_id", organizationId)
      .eq("report_type", "mbo_autopay")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadScheduledIncreases(supabase, organizationId),
  ]);

  const adjustments = adjustmentRows.map((row) => ({
    id: row.id,
    mindbodyClientId: row.mindbody_client_id,
    contractId: row.member_contract_id,
    kind: row.kind,
    amountCents: row.amount_cents,
    percent: row.percent === null ? null : Number(row.percent),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    reason: row.reason,
    createdAt: row.created_at,
  }));

  const reportDates = report.map((row) => row.charge_date).sort();
  const reportRange = reportDates.length ? { from: reportDates[0], to: reportDates[reportDates.length - 1] } : null;
  // Contracts list only charges from their last refresh on, so the
  // comparison starts tomorrow and ends with the report.
  const tomorrow = DateTime.now().setZone(timezone).plus({ days: 1 }).toISODate()!;
  const window =
    reportRange && reportRange.to >= tomorrow
      ? {
          from: tomorrow > reportRange.from ? tomorrow : reportRange.from,
          to: reportRange.to,
        }
      : null;

  const schedules: ContractSchedule[] = contracts.map((contract) => ({
    contractId: contract.id,
    mindbodyClientId: contract.mindbody_client_id,
    payerClientId: contract.payer_mindbody_client_id,
    contractName: contract.contract_name,
    autopayStatus: contract.autopay_status,
    autopays: contract.upcoming_autopays ?? [],
  }));
  const clientsWithContracts = new Set(
    contracts.flatMap((contract) =>
      [contract.mindbody_client_id, contract.payer_mindbody_client_id].filter((id): id is string => Boolean(id)),
    ),
  );

  const lines = window
    ? compareCharges(
        expectedCharges(schedules, adjustments, window, increases),
        report.map((row) => ({
          mindbodyClientId: row.mindbody_client_id,
          clientName: row.client_name,
          date: row.charge_date,
          cents: row.amount_cents,
          status: row.status,
        })),
        { ...window, clientsWithContracts },
      )
    : [];

  // Names for lines that only SynqIQ has (no report line to name them).
  const namesByClientId = new Map<string, string>();
  for (const row of report) if (row.mindbody_client_id) namesByClientId.set(row.mindbody_client_id, row.client_name);
  const missingNames = [
    ...new Set([...lines.map((line) => line.mindbodyClientId), ...adjustments.map((adjustment) => adjustment.mindbodyClientId)]),
  ].filter((id): id is string => Boolean(id) && !namesByClientId.has(id as string));
  for (let index = 0; index < missingNames.length; index += 200) {
    const { data } = await supabase
      .from("clients")
      .select("mindbody_client_id, first_name, last_name")
      .eq("organization_id", organizationId)
      .in("mindbody_client_id", missingNames.slice(index, index + 200));
    for (const row of data ?? []) {
      namesByClientId.set(row.mindbody_client_id as string, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim());
    }
  }

  const contractsSyncedAt = contracts.reduce<string | null>(
    (latest, contract) => (!latest || contract.synced_at > latest ? contract.synced_at : latest),
    null,
  );

  return {
    window,
    lines,
    summary: summarize(lines),
    adjustments,
    namesByClientId,
    contractsSyncedAt,
    reportUploadedAt: (lastImport?.created_at as string | undefined) ?? null,
    reportRange,
  };
}
