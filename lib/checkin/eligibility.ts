// Can this person check in, and what covers the visit? Mirrors Mindbody:
// a visit is covered by a current service in an arrival program
// ("Memberships & Passes": every membership carries one, and so do guest
// passes) with sessions left. Pure; unit-tested in tests/check-in.test.ts.

export type ServiceInfo = {
  id: number;
  name: string;
  program: string | null;
  count: number | null;
  remaining: number | null;
  activeDate: string | null; // YYYY-MM-DD
  expirationDate: string | null;
  current: boolean | null;
};

export type ContractInfo = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  autopayStatus: string | null;
};

export type SynqiqEdit = { kind: "freeze" | "cancel"; startsOn: string; endsOn: string | null };

export type CheckInDecision = {
  covered: boolean;
  kind: "membership" | "pass" | "none";
  coverageName: string | null;
  serviceId: number | null;
  contractId: string | null;
  remaining: number | null; // null = unlimited
  warnings: string[];
  // Billing standing for the front desk: red ("attention") when declined,
  // terminated or frozen; green ("good") when covered and in good standing;
  // "none" otherwise (e.g. a guest with nothing).
  standing: "good" | "attention" | "none";
  standingReasons: string[];
};

// Mindbody client statuses that need the front desk's attention.
const ATTENTION_STATUSES: Record<string, string> = {
  declined: "Payment declined",
  terminated: "Membership terminated",
  suspended: "Membership frozen",
};

const UNLIMITED = 9999;

export function decideCheckIn(input: {
  today: string;
  services: ServiceInfo[];
  arrivalPrograms: string[];
  contracts: ContractInfo[];
  synqiqEdits: SynqiqEdit[];
  clientStatus: string | null;
  alreadyCheckedInToday: boolean;
}): CheckInDecision {
  const { today } = input;
  const warnings: string[] = [];
  const arrival = new Set(input.arrivalPrograms.map((name) => name.toLowerCase()));
  const usable = input.services.filter(
    (service) =>
      service.program !== null &&
      arrival.has(service.program.toLowerCase()) &&
      service.current !== false &&
      (!service.activeDate || service.activeDate <= today) &&
      (!service.expirationDate || service.expirationDate >= today) &&
      (service.remaining === null || service.remaining > 0),
  );
  // Unlimited (membership) first, then the pass expiring soonest.
  usable.sort(
    (a, b) =>
      Number((b.count ?? 0) >= UNLIMITED) - Number((a.count ?? 0) >= UNLIMITED) ||
      (a.expirationDate ?? "9999").localeCompare(b.expirationDate ?? "9999"),
  );
  const best = usable[0] ?? null;

  const currentContracts = input.contracts.filter(
    (contract) => (!contract.startDate || contract.startDate <= today) && (!contract.endDate || contract.endDate >= today),
  );
  const contract = best ? (currentContracts.find((item) => item.name.toLowerCase() === best.name.toLowerCase()) ?? null) : null;
  const frozen = currentContracts.find((item) => (item.autopayStatus ?? "").toLowerCase() === "suspended");
  if (frozen) warnings.push(`${frozen.name} is frozen in Mindbody.`);
  for (const edit of input.synqiqEdits) {
    const active = edit.startsOn <= today && (!edit.endsOn || edit.endsOn >= today);
    if (active && edit.kind === "freeze") warnings.push("Frozen in SynqIQ (planned for after the switch).");
    if (active && edit.kind === "cancel") warnings.push("Cancelled in SynqIQ (planned for after the switch).");
  }
  if ((input.clientStatus ?? "").toLowerCase() === "declined") warnings.push("Their last payment was declined.");
  if (input.alreadyCheckedInToday) warnings.push("Already checked in today.");

  const standingReasons: string[] = [];
  const statusReason = ATTENTION_STATUSES[(input.clientStatus ?? "").toLowerCase()];
  if (statusReason) standingReasons.push(statusReason);
  if (frozen && !standingReasons.includes("Membership frozen")) standingReasons.push("Membership frozen");
  if (warnings.some((warning) => warning.startsWith("Frozen in SynqIQ")) && !standingReasons.includes("Membership frozen"))
    standingReasons.push("Membership frozen");
  if (warnings.some((warning) => warning.startsWith("Cancelled in SynqIQ"))) standingReasons.push("Membership cancelled");
  const standingFor = (covered: boolean): CheckInDecision["standing"] => (standingReasons.length ? "attention" : covered ? "good" : "none");

  if (!best) {
    return {
      covered: false,
      kind: "none",
      coverageName: null,
      serviceId: null,
      contractId: null,
      remaining: null,
      warnings,
      standing: standingFor(false),
      standingReasons,
    };
  }
  const unlimited = (best.count ?? 0) >= UNLIMITED;
  if (!unlimited && best.remaining !== null && best.remaining <= 2)
    warnings.push(`${best.remaining} visit${best.remaining === 1 ? "" : "s"} left on ${best.name}.`);
  if (best.expirationDate && best.expirationDate <= addDays(today, 3) && !contract)
    warnings.push(`${best.name} expires ${best.expirationDate}.`);
  return {
    covered: true,
    // Guest passes can be unlimited too, so "membership" needs a current contract.
    kind: contract || (unlimited && currentContracts.length > 0) ? "membership" : "pass",
    coverageName: best.name,
    serviceId: best.id,
    contractId: contract?.id ?? null,
    remaining: unlimited ? null : best.remaining,
    warnings,
    standing: standingFor(true),
    standingReasons,
  };
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
