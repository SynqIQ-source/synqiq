// Shadow billing: what SynqIQ would charge each member on each date, compared
// with what Mindbody charges (its AutoPay Detail report). Pure functions, no
// I/O, so the rules are unit-tested (tests/shadow-billing.test.ts).
//
// Until the switch SynqIQ's schedule is Mindbody's own upcoming autopays
// (imported per contract), with SynqIQ's billing edits applied on top. Every
// difference from Mindbody's report gets a reason.

export type ContractSchedule = {
  contractId: string; // member_contracts.id
  mindbodyClientId: string;
  // Who is charged when someone else pays (a parent covering a family
  // add-on): Mindbody's report lists the charge under the payer.
  payerClientId?: string | null;
  contractName: string;
  // Mindbody's autopay status for the contract (e.g. "Suspended" while frozen).
  autopayStatus?: string | null;
  autopays: { date: string; totalCents: number | null }[];
};

export type AdjustmentKind = "credit" | "discount_once" | "discount_ongoing" | "freeze";

export type BillingAdjustment = {
  id: string;
  mindbodyClientId: string;
  contractId: string | null; // null = every contract of the member
  kind: AdjustmentKind;
  amountCents: number | null; // credit / $ discount
  percent: number | null; // % discount (0-100)
  startsOn: string; // YYYY-MM-DD
  endsOn: string | null; // inclusive; freezes and ongoing discounts
  reason: string;
};

export type ExpectedCharge = {
  mindbodyClientId: string;
  date: string;
  cents: number; // after SynqIQ edits
  baseCents: number; // before SynqIQ edits
  contractIds: string[];
  adjustmentIds: string[];
  // Part of `cents` that comes from contracts Mindbody shows as frozen.
  frozenContractCents: number;
};

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;

// One expected charge per paying member and date (Mindbody's report lists
// items separately and under whoever pays; the comparison is per payer per
// day). Edits belong to the member whose contract it is, applied in
// date order: freezes zero a charge, discounts reduce it, credits are used
// up across charges until exhausted. Never below zero.
export function expectedCharges(
  schedules: ContractSchedule[],
  adjustments: BillingAdjustment[],
  window: { from: string; to: string },
): ExpectedCharge[] {
  type Line = { contractId: string; client: string; payer: string; date: string; cents: number; frozen: boolean };
  const lines: Line[] = [];
  for (const schedule of schedules) {
    for (const autopay of schedule.autopays) {
      if (autopay.totalCents === null || !inRange(autopay.date, window.from, window.to)) continue;
      lines.push({
        contractId: schedule.contractId,
        client: schedule.mindbodyClientId,
        payer: schedule.payerClientId ?? schedule.mindbodyClientId,
        date: autopay.date,
        cents: autopay.totalCents,
        frozen: (schedule.autopayStatus ?? "").toLowerCase() === "suspended",
      });
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.contractId.localeCompare(b.contractId));

  const creditLeft = new Map<string, number>();
  for (const adjustment of adjustments) if (adjustment.kind === "credit") creditLeft.set(adjustment.id, adjustment.amountCents ?? 0);
  const onceUsed = new Set<string>();

  const byKey = new Map<string, ExpectedCharge>();
  for (const line of lines) {
    let cents = line.cents;
    const applied: string[] = [];
    const applies = (adjustment: BillingAdjustment) =>
      adjustment.mindbodyClientId === line.client &&
      (adjustment.contractId === null || adjustment.contractId === line.contractId) &&
      line.date >= adjustment.startsOn &&
      (adjustment.endsOn === null || line.date <= adjustment.endsOn);

    for (const adjustment of adjustments.filter((candidate) => candidate.kind === "freeze" && applies(candidate))) {
      cents = 0;
      applied.push(adjustment.id);
    }
    for (const adjustment of adjustments.filter(
      (candidate) => (candidate.kind === "discount_ongoing" || candidate.kind === "discount_once") && applies(candidate),
    )) {
      if (cents === 0) break;
      if (adjustment.kind === "discount_once") {
        if (onceUsed.has(adjustment.id)) continue;
        onceUsed.add(adjustment.id);
      }
      const off =
        adjustment.percent !== null ? Math.round((cents * adjustment.percent) / 100) : Math.min(cents, adjustment.amountCents ?? 0);
      cents -= off;
      applied.push(adjustment.id);
    }
    for (const adjustment of adjustments.filter((candidate) => candidate.kind === "credit" && applies(candidate))) {
      const left = creditLeft.get(adjustment.id) ?? 0;
      if (left <= 0 || cents === 0) continue;
      const used = Math.min(left, cents);
      cents -= used;
      creditLeft.set(adjustment.id, left - used);
      applied.push(adjustment.id);
    }

    const key = `${line.payer}|${line.date}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.cents += cents;
      existing.baseCents += line.cents;
      existing.contractIds.push(line.contractId);
      if (line.frozen) existing.frozenContractCents += cents;
      for (const id of applied) if (!existing.adjustmentIds.includes(id)) existing.adjustmentIds.push(id);
    } else {
      byKey.set(key, {
        mindbodyClientId: line.payer,
        date: line.date,
        cents,
        baseCents: line.cents,
        contractIds: [line.contractId],
        adjustmentIds: [...applied],
        frozenContractCents: line.frozen ? cents : 0,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.mindbodyClientId.localeCompare(b.mindbodyClientId));
}

export type ReportLine = {
  mindbodyClientId: string | null;
  clientName: string;
  date: string;
  cents: number;
  status: "success" | "scheduled" | "suspended" | "declined" | "other";
};

export type ComparisonReason =
  | "match"
  | "frozen_in_mindbody"
  | "amount_differs"
  | "changed_by_synqiq"
  | "member_not_matched"
  | "contract_not_imported"
  | "no_scheduled_charge"
  | "not_in_mindbody";

export type ComparisonLine = {
  key: string;
  mindbodyClientId: string | null;
  clientName: string | null;
  date: string;
  mindbodyCents: number; // what Mindbody charges (frozen lines count as 0)
  synqiqCents: number; // after SynqIQ edits
  synqiqBaseCents: number; // before SynqIQ edits
  mindbodyStatus: ReportLine["status"] | "mixed" | null;
  reason: ComparisonReason;
  adjustmentIds: string[];
};

const TOLERANCE_CENTS = 1;

export function compareCharges(
  expected: ExpectedCharge[],
  report: ReportLine[],
  options: { from: string; to: string; clientsWithContracts: Set<string> },
): ComparisonLine[] {
  type Group = { clientId: string | null; name: string; date: string; cents: number; statuses: Set<ReportLine["status"]> };
  const groups = new Map<string, Group>();
  for (const line of report) {
    if (!inRange(line.date, options.from, options.to)) continue;
    const key = `${line.mindbodyClientId ?? `name:${line.clientName.toLowerCase()}`}|${line.date}`;
    const group = groups.get(key) ?? { clientId: line.mindbodyClientId, name: line.clientName, date: line.date, cents: 0, statuses: new Set() };
    // A frozen line isn't charged.
    if (line.status !== "suspended") group.cents += line.cents;
    group.statuses.add(line.status);
    groups.set(key, group);
  }

  const expectedByKey = new Map(expected.map((charge) => [`${charge.mindbodyClientId}|${charge.date}`, charge]));
  const result: ComparisonLine[] = [];

  for (const [key, group] of groups) {
    const charge = expectedByKey.get(key);
    expectedByKey.delete(key);
    const status = group.statuses.size === 1 ? [...group.statuses][0] : "mixed";
    const onlyFrozen = group.statuses.size === 1 && group.statuses.has("suspended");
    let reason: ComparisonReason;
    if (!group.clientId) reason = "member_not_matched";
    // Frozen in Mindbody that day. Mindbody's API doesn't give freeze dates,
    // so SynqIQ's copy may still list the charge; the freeze explains it.
    else if (onlyFrozen) reason = "frozen_in_mindbody";
    else if (!charge) reason = options.clientsWithContracts.has(group.clientId) ? "no_scheduled_charge" : "contract_not_imported";
    else if (Math.abs(charge.cents - group.cents) <= TOLERANCE_CENTS) reason = "match";
    // Mindbody skipped a frozen contract that SynqIQ's copy still lists.
    else if (
      group.statuses.has("suspended") &&
      charge.frozenContractCents > 0 &&
      Math.abs(charge.cents - charge.frozenContractCents - group.cents) <= TOLERANCE_CENTS
    )
      reason = "frozen_in_mindbody";
    else if (charge.adjustmentIds.length > 0 && Math.abs(charge.baseCents - group.cents) <= TOLERANCE_CENTS) reason = "changed_by_synqiq";
    else reason = "amount_differs";
    result.push({
      key,
      mindbodyClientId: group.clientId,
      clientName: group.name,
      date: group.date,
      mindbodyCents: group.cents,
      synqiqCents: charge?.cents ?? 0,
      synqiqBaseCents: charge?.baseCents ?? 0,
      mindbodyStatus: status,
      reason,
      adjustmentIds: charge?.adjustmentIds ?? [],
    });
  }

  // SynqIQ expects a charge Mindbody's report doesn't have.
  for (const [key, charge] of expectedByKey) {
    if (charge.baseCents === 0) continue;
    result.push({
      key,
      mindbodyClientId: charge.mindbodyClientId,
      clientName: null,
      date: charge.date,
      mindbodyCents: 0,
      synqiqCents: charge.cents,
      synqiqBaseCents: charge.baseCents,
      mindbodyStatus: null,
      reason: charge.adjustmentIds.length > 0 && charge.cents === 0 ? "changed_by_synqiq" : "not_in_mindbody",
      adjustmentIds: charge.adjustmentIds,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export function summarize(lines: ComparisonLine[]) {
  const byReason = new Map<ComparisonReason, { count: number; mindbodyCents: number; synqiqCents: number }>();
  let mindbodyCents = 0;
  let synqiqCents = 0;
  for (const line of lines) {
    mindbodyCents += line.mindbodyCents;
    synqiqCents += line.synqiqCents;
    const entry = byReason.get(line.reason) ?? { count: 0, mindbodyCents: 0, synqiqCents: 0 };
    entry.count += 1;
    entry.mindbodyCents += line.mindbodyCents;
    entry.synqiqCents += line.synqiqCents;
    byReason.set(line.reason, entry);
  }
  const matched = byReason.get("match")?.count ?? 0;
  const compared = lines.filter((line) => line.reason !== "frozen_in_mindbody").length;
  return { mindbodyCents, synqiqCents, byReason, matched, compared, matchRate: compared ? matched / compared : 1 };
}
