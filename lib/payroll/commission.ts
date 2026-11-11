// Commission math. All money is integer cents. Commission is always figured
// on the PRE-TAX line amount (what was charged for the item, after discounts,
// before sales tax), never on the total collected.

export const COMMISSION_CATEGORIES = ["membership", "enrollment_fee", "pt_package", "retail", "other", "none"] as const;
export type CommissionCategory = (typeof COMMISSION_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<CommissionCategory, string> = {
  membership: "Membership",
  enrollment_fee: "Enrollment fee",
  pt_package: "PT package",
  retail: "Retail",
  other: "Other",
  none: "No commission",
};

export const COMMISSION_CONDITIONS = ["any", "new_membership", "new_pt_client", "handoff"] as const;
export type CommissionCondition = (typeof COMMISSION_CONDITIONS)[number];
export const CONDITION_LABELS: Record<CommissionCondition, string> = {
  any: "Every sale",
  new_membership: "New memberships only (not renewals or autopay)",
  new_pt_client: "Only clients with no PT in the last few months",
  handoff: "Only when a Club Admin approves a handoff on the sale",
};

export type CommissionRule = {
  id: string;
  planId: string;
  category: Exclude<CommissionCategory, "none">;
  condition: CommissionCondition;
  percent: number | null;
  flatCents: number | null;
};

export type CommissionPlan = {
  id: string;
  name: string;
  defaultRoles: string[];
  defaultTrainers: boolean;
  defaultEnabled: boolean;
  earnOn: "sale" | "payment";
  rules: CommissionRule[];
};

// One line of a sale, with the facts the conditions need.
export type SaleLine = {
  category: CommissionCategory;
  quantity: number;
  totalCents: number; // line total including tax
  taxCents: number;
  isNewMembership: boolean; // membership contract started with this sale (not a renewal / autopay charge)
  isNewPtClient: boolean; // client had no PT in the lookback window before the sale
  handoffApproved: boolean; // a Club Admin checked "Handoff: pays commission"
};

export function preTaxCents(line: Pick<SaleLine, "totalCents" | "taxCents">): number {
  return Math.max(0, line.totalCents - Math.max(0, line.taxCents));
}

export function ruleAmountCents(rule: Pick<CommissionRule, "percent" | "flatCents">, baseCents: number, quantity: number): number {
  const percentPart = rule.percent ? Math.round((baseCents * rule.percent) / 100) : 0;
  const flatPart = rule.flatCents ? Math.round(rule.flatCents * Math.max(1, quantity)) : 0;
  return percentPart + flatPart;
}

export function conditionMet(condition: CommissionCondition, line: SaleLine): boolean {
  if (condition === "any") return true;
  if (condition === "new_membership") return line.isNewMembership;
  if (condition === "new_pt_client") return line.isNewPtClient;
  return line.handoffApproved;
}

// The rule that pays this line under a plan: the first rule for the line's
// category whose condition is met. More specific conditions are tried before
// "every sale", so a plan can pay differently for new vs. other sales.
const ORDER: CommissionCondition[] = ["handoff", "new_pt_client", "new_membership", "any"];
export function matchRule(plan: Pick<CommissionPlan, "rules">, line: SaleLine): CommissionRule | null {
  if (line.category === "none") return null;
  const rules = plan.rules
    .filter((rule) => rule.category === line.category)
    .sort((a, b) => ORDER.indexOf(a.condition) - ORDER.indexOf(b.condition));
  return rules.find((rule) => conditionMet(rule.condition, line)) ?? null;
}

export function commissionForLine(plan: Pick<CommissionPlan, "rules">, line: SaleLine) {
  const rule = matchRule(plan, line);
  if (!rule) return null;
  const baseCents = preTaxCents(line);
  const amountCents = ruleAmountCents(rule, baseCents, line.quantity);
  return amountCents > 0 ? { rule, baseCents, amountCents } : null;
}

// Which plan a person is on, and whether it pays them: their own setting,
// else the plan that defaults to their role, else the trainer default.
export function planForPerson(
  person: { role: string; isTrainer: boolean },
  setting: { planId: string | null; enabled: boolean | null } | null,
  plans: CommissionPlan[],
): { plan: CommissionPlan; enabled: boolean; fromDefault: boolean } | null {
  const explicit = setting?.planId ? plans.find((plan) => plan.id === setting.planId) : undefined;
  const plan =
    explicit ??
    plans.find((candidate) => candidate.defaultRoles.includes(person.role)) ??
    (person.isTrainer ? plans.find((candidate) => candidate.defaultTrainers) : undefined);
  if (!plan) return null;
  return { plan, enabled: setting?.enabled ?? plan.defaultEnabled, fromDefault: !explicit };
}

// A first guess at a product's category from its name, for products a Club
// Admin hasn't categorized yet. Retail and unknowns start as "none" so nothing
// pays until someone says it should.
export function guessCategory(name: string, hasContract: boolean): CommissionCategory {
  const text = name.toLowerCase();
  if (/(enrol?lment|registration)\s*fee/.test(text)) return "enrollment_fee";
  if (/employee/.test(text)) return "none";
  if (/(^|[^a-z])pt([^a-z]|$)|personal training|semi[- ]?private/.test(text)) return "pt_package";
  if (hasContract && /(membership|commitment|presale|promo)/.test(text)) return "membership";
  return "none";
}

export function commissionRuleProblem(input: {
  category: string;
  condition: string;
  percent: number | null;
  flatCents: number | null;
}): string | null {
  if (!COMMISSION_CATEGORIES.includes(input.category as CommissionCategory) || input.category === "none") return "Pick a category.";
  if (!COMMISSION_CONDITIONS.includes(input.condition as CommissionCondition)) return "Pick when it pays.";
  if (input.percent == null && input.flatCents == null) return "Enter a percent, a flat amount, or both.";
  if (input.percent != null && (!Number.isFinite(input.percent) || input.percent < 0 || input.percent > 100))
    return "Enter a percent between 0 and 100.";
  if (input.flatCents != null && (!Number.isFinite(input.flatCents) || input.flatCents < 0 || input.flatCents > 1_000_000))
    return "Enter a flat amount between $0 and $10,000.";
  return null;
}

export function describeRule(rule: Pick<CommissionRule, "percent" | "flatCents">): string {
  const parts: string[] = [];
  if (rule.percent) parts.push(`${rule.percent}% of the pre-tax price`);
  if (rule.flatCents) parts.push(`$${(rule.flatCents / 100).toFixed(rule.flatCents % 100 ? 2 : 0)} per unit`);
  return parts.join(" + ") || "Nothing";
}
