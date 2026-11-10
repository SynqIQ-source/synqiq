// Bulk % price increases: which memberships a search covers, the new dues,
// validation and the notice-email draft. Pure, so the rules are unit-tested
// (tests/price-increase.test.ts).

export type IncreaseFilters = {
  originalStartFrom: string | null; // YYYY-MM-DD, inclusive ("members since" range)
  originalStartTo: string | null;
  plans: string[]; // contract names; empty = every plan
  priceMinCents: number | null; // current dues before tax, inclusive
  priceMaxCents: number | null;
};

export type IncreaseCandidate = {
  contractId: string;
  mindbodyClientContractId: number;
  mindbodyClientId: string;
  contractName: string;
  originalStartDate: string | null;
  startDate: string | null;
  endDate: string | null;
  autopayStatus: string | null;
  autoRenewing: boolean | null;
  normalAutopayCents: number | null; // dues before tax
  taxRate?: number | null; // fraction, e.g. 0.0825 (lib/memberships/tax.ts)
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A membership that will still be billing: has dues, autopay not ended,
// and either open-ended, running past today, or set to renew itself.
export function isBillingMembership(contract: IncreaseCandidate, today: string): boolean {
  if (!contract.normalAutopayCents || contract.normalAutopayCents <= 0) return false;
  const status = (contract.autopayStatus ?? "").toLowerCase();
  if (status && status !== "active" && status !== "suspended") return false;
  return !contract.endDate || contract.endDate >= today || contract.autoRenewing === true;
}

export function matchesFilters(contract: IncreaseCandidate, filters: IncreaseFilters, today: string): boolean {
  if (!isBillingMembership(contract, today)) return false;
  const since = contract.originalStartDate ?? contract.startDate;
  if (filters.originalStartFrom && (!since || since < filters.originalStartFrom)) return false;
  if (filters.originalStartTo && (!since || since > filters.originalStartTo)) return false;
  if (filters.plans.length && !filters.plans.includes(contract.contractName)) return false;
  const price = contract.normalAutopayCents ?? 0;
  if (filters.priceMinCents !== null && price < filters.priceMinCents) return false;
  if (filters.priceMaxCents !== null && price > filters.priceMaxCents) return false;
  return true;
}

// New dues for a % increase; optionally rounded UP to a whole dollar (so
// rounding never undoes the increase).
export function increasedCents(oldCents: number, percent: number, roundToDollar: boolean): number {
  const raw = Math.round((oldCents * (100 + percent)) / 100);
  return roundToDollar ? Math.ceil(raw / 100) * 100 : raw;
}

export function parseFilters(input: unknown): { ok: true; value: IncreaseFilters } | { ok: false; error: string } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const date = (value: unknown) => (value === undefined || value === null || value === "" ? null : value);
  const from = date(raw.originalStartFrom);
  const to = date(raw.originalStartTo);
  if (from !== null && (typeof from !== "string" || !DATE.test(from)))
    return { ok: false, error: "Pick a valid 'members since' start date." };
  if (to !== null && (typeof to !== "string" || !DATE.test(to))) return { ok: false, error: "Pick a valid 'members since' end date." };
  if (from && to && to < from)
    return {
      ok: false,
      error: "The 'members since' range ends before it starts.",
    };
  const plans = Array.isArray(raw.plans)
    ? raw.plans.filter((plan): plan is string => typeof plan === "string" && plan.length > 0 && plan.length <= 200)
    : [];
  if (plans.length > 100) return { ok: false, error: "Too many plans picked." };
  const cents = (value: unknown) =>
    value === undefined || value === null || value === ""
      ? null
      : typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : NaN;
  const min = cents(raw.priceMinCents);
  const max = cents(raw.priceMaxCents);
  if (Number.isNaN(min) || Number.isNaN(max)) return { ok: false, error: "Enter valid prices." };
  if (min !== null && max !== null && max < min) return { ok: false, error: "The highest price is below the lowest." };
  return {
    ok: true,
    value: {
      originalStartFrom: from as string | null,
      originalStartTo: to as string | null,
      plans,
      priceMinCents: min,
      priceMaxCents: max,
    },
  };
}

export type IncreaseInput = {
  name?: unknown;
  percent?: unknown;
  effectiveOn?: unknown;
  roundToDollar?: unknown;
  noticeSubject?: unknown;
  noticeBody?: unknown;
};

export function validateIncrease(
  input: IncreaseInput,
  cutover: string,
  today: string,
):
  | {
      ok: true;
      value: {
        name: string;
        percent: number;
        effectiveOn: string;
        roundToDollar: boolean;
        noticeSubject: string;
        noticeBody: string;
      };
    }
  | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Name the increase (e.g. 2027 dues increase)." };
  if (name.length > 120) return { ok: false, error: "Keep the name under 120 characters." };
  const percent = input.percent;
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent <= 0 ||
    percent > 100 ||
    Math.round(percent * 100) !== percent * 100
  ) {
    return { ok: false, error: "Enter a percent between 0.01 and 100." };
  }
  const effectiveOn = input.effectiveOn;
  if (typeof effectiveOn !== "string" || !DATE.test(effectiveOn)) return { ok: false, error: "Pick the date the new prices start." };
  if (effectiveOn < cutover)
    return {
      ok: false,
      error: `Increases can start on or after the billing switch (${cutover}).`,
    };
  if (effectiveOn <= today) return { ok: false, error: "The start date must be in the future." };
  const noticeSubject = typeof input.noticeSubject === "string" ? input.noticeSubject.trim() : "";
  const noticeBody = typeof input.noticeBody === "string" ? input.noticeBody.trim() : "";
  if (noticeSubject.length > 200 || noticeBody.length > 10_000) return { ok: false, error: "The notice draft is too long." };
  return {
    ok: true,
    value: {
      name,
      percent,
      effectiveOn,
      roundToDollar: input.roundToDollar === true,
      noticeSubject,
      noticeBody,
    },
  };
}

export const DEFAULT_NOTICE_SUBJECT = "An update to your membership dues";
export const DEFAULT_NOTICE_BODY = `Hi {first_name},

Thank you for being a member since {member_since}. Starting {effective_date}, your {plan} dues will change from {old_price} to {new_price} a month (plus tax).

If you have any questions, reply to this email or stop by the front desk.

Thank you,
{studio_name}`;

export type NoticeVariables = {
  first_name: string;
  member_since: string;
  effective_date: string;
  plan: string;
  old_price: string;
  new_price: string;
  studio_name: string;
};

// Fills {placeholders}; unknown ones are left as typed so a typo shows up
// in the preview.
export function renderNotice(template: string, variables: NoticeVariables): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key as keyof NoticeVariables] : match,
  );
}

// Upcoming charge after scheduled increases: a charge on/after an
// increase's start date scales by new/old dues (tax scales with it).
export type ScheduledIncrease = {
  id: string;
  contractId: string;
  effectiveOn: string;
  oldCents: number;
  newCents: number;
};
export function applyIncreases(
  cents: number,
  contractId: string,
  date: string,
  increases: ScheduledIncrease[],
): { cents: number; ids: string[] } {
  let result = cents;
  const ids: string[] = [];
  for (const increase of increases) {
    if (increase.contractId !== contractId || date < increase.effectiveOn || increase.oldCents <= 0) continue;
    result = Math.round((result * increase.newCents) / increase.oldCents);
    ids.push(increase.id);
  }
  return { cents: result, ids };
}
