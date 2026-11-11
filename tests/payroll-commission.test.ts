import { describe, expect, it } from "vitest";
import {
  commissionForLine,
  commissionRuleProblem,
  describeRule,
  guessCategory,
  planForPerson,
  preTaxCents,
  type CommissionPlan,
  type SaleLine,
} from "@/lib/payroll/commission";

const salesTeam: CommissionPlan = {
  id: "sales",
  name: "Sales Team",
  defaultRoles: ["sales", "sales_lead"],
  defaultTrainers: false,
  defaultEnabled: true,
  earnOn: "sale",
  rules: [
    { id: "m", planId: "sales", category: "membership", condition: "new_membership", percent: 20, flatCents: null },
    { id: "e", planId: "sales", category: "enrollment_fee", condition: "any", percent: 20, flatCents: null },
    { id: "p", planId: "sales", category: "pt_package", condition: "new_pt_client", percent: 10, flatCents: null },
  ],
};
const handoff: CommissionPlan = {
  id: "handoff",
  name: "Trainer Handoff",
  defaultRoles: [],
  defaultTrainers: true,
  defaultEnabled: true,
  earnOn: "sale",
  rules: [{ id: "h", planId: "handoff", category: "pt_package", condition: "handoff", percent: 10, flatCents: null }],
};

const line = (overrides: Partial<SaleLine>): SaleLine => ({
  category: "membership",
  quantity: 1,
  totalCents: 29119,
  taxCents: 2219,
  isNewMembership: true,
  isNewPtClient: false,
  handoffApproved: false,
  ...overrides,
});

describe("pre-tax base", () => {
  it("leaves the tax out", () => {
    expect(preTaxCents({ totalCents: 29119, taxCents: 2219 })).toBe(26900);
    expect(preTaxCents({ totalCents: 100, taxCents: 500 })).toBe(0);
  });
});

describe("sales team", () => {
  it("pays 20% of the pre-tax price on a new membership, not on tax", () => {
    expect(commissionForLine(salesTeam, line({}))?.amountCents).toBe(5380); // 20% of $269, not of $291.19
  });
  it("pays nothing on a renewal or autopay charge", () => {
    expect(commissionForLine(salesTeam, line({ isNewMembership: false }))).toBeNull();
  });
  it("pays 20% of the enrollment fee", () => {
    expect(commissionForLine(salesTeam, line({ category: "enrollment_fee", totalCents: 10000, taxCents: 0 }))?.amountCents).toBe(2000);
  });
  it("pays 10% on PT only for clients with no recent PT", () => {
    const pt = line({ category: "pt_package", totalCents: 176000, taxCents: 0 });
    expect(commissionForLine(salesTeam, { ...pt, isNewPtClient: true })?.amountCents).toBe(17600);
    expect(commissionForLine(salesTeam, { ...pt, isNewPtClient: false })).toBeNull();
  });
  it("pays nothing on retail or uncategorized items", () => {
    expect(commissionForLine(salesTeam, line({ category: "retail" }))).toBeNull();
    expect(commissionForLine(salesTeam, line({ category: "none" }))).toBeNull();
  });
});

describe("trainer handoff", () => {
  it("pays 10% only when a Club Admin approves the handoff", () => {
    const pt = line({ category: "pt_package", totalCents: 54000, taxCents: 0, isNewPtClient: true });
    expect(commissionForLine(handoff, pt)).toBeNull();
    expect(commissionForLine(handoff, { ...pt, handoffApproved: true })?.amountCents).toBe(5400);
  });
});

describe("flat and mixed rules", () => {
  it("pays a flat amount per unit, or percent plus flat", () => {
    const flat: CommissionPlan = { ...salesTeam, rules: [{ ...salesTeam.rules[0], percent: null, flatCents: 5000 }] };
    expect(commissionForLine(flat, line({}))?.amountCents).toBe(5000);
    const both: CommissionPlan = { ...salesTeam, rules: [{ ...salesTeam.rules[0], percent: 10, flatCents: 2500 }] };
    expect(commissionForLine(both, line({ quantity: 2, totalCents: 20000, taxCents: 0 }))?.amountCents).toBe(2000 + 5000);
    expect(describeRule({ percent: 10, flatCents: 2500 })).toBe("10% of the pre-tax price + $25 per unit");
  });
  it("prefers the specific rule over 'every sale' for the same category", () => {
    const plan: CommissionPlan = {
      ...salesTeam,
      rules: [
        { id: "any", planId: "x", category: "membership", condition: "any", percent: 5, flatCents: null },
        { id: "new", planId: "x", category: "membership", condition: "new_membership", percent: 20, flatCents: null },
      ],
    };
    expect(commissionForLine(plan, line({}))?.rule.id).toBe("new");
    expect(commissionForLine(plan, line({ isNewMembership: false }))?.rule.id).toBe("any");
  });
});

describe("who is on which plan", () => {
  const plans = [salesTeam, { ...handoff, defaultEnabled: false }];
  it("defaults from role, then trainer tag; a person's own setting wins", () => {
    expect(planForPerson({ role: "sales", isTrainer: false }, null, plans)?.plan.id).toBe("sales");
    expect(planForPerson({ role: "staff", isTrainer: true }, null, plans)).toMatchObject({ enabled: false });
    expect(planForPerson({ role: "staff", isTrainer: false }, null, plans)).toBeNull();
    expect(planForPerson({ role: "staff", isTrainer: true }, { planId: null, enabled: true }, plans)?.enabled).toBe(true);
    expect(planForPerson({ role: "sales", isTrainer: false }, { planId: null, enabled: false }, plans)?.enabled).toBe(false);
    expect(planForPerson({ role: "staff", isTrainer: false }, { planId: "sales", enabled: null }, plans)?.fromDefault).toBe(false);
  });
});

describe("categories and validation", () => {
  it("guesses categories from product names", () => {
    expect(guessCategory("Adult Monthly Membership Enrollment Fee", true)).toBe("enrollment_fee");
    expect(guessCategory("Registration Fee", true)).toBe("enrollment_fee");
    expect(guessCategory("PT 60 16PK", true)).toBe("pt_package");
    expect(guessCategory("PT Semi Private 4pk", true)).toBe("pt_package");
    expect(guessCategory("12 Month Commitment", true)).toBe("membership");
    expect(guessCategory("Employee Membership", true)).toBe("none");
    expect(guessCategory("LMNT - Citrus", false)).toBe("none");
    expect(guessCategory("Optimum Nutrition", false)).toBe("none");
  });
  it("validates rules", () => {
    expect(commissionRuleProblem({ category: "membership", condition: "any", percent: 20, flatCents: null })).toBeNull();
    expect(commissionRuleProblem({ category: "none", condition: "any", percent: 20, flatCents: null })).toMatch(/category/);
    expect(commissionRuleProblem({ category: "membership", condition: "any", percent: null, flatCents: null })).toMatch(/percent/);
    expect(commissionRuleProblem({ category: "membership", condition: "any", percent: 120, flatCents: null })).toMatch(/between/);
  });
});
