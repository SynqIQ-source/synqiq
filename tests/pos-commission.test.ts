import { describe, expect, it } from "vitest";
import { commissionCategoryFor, posCommissions, type PosCommissionInput } from "@/lib/payroll/pos-commission";
import type { CommissionPlan } from "@/lib/payroll/commission";

const sales: CommissionPlan = {
  id: "plan-sales",
  name: "Sales Team",
  defaultRoles: ["sales"],
  defaultTrainers: false,
  defaultEnabled: true,
  earnOn: "sale",
  rules: [
    { id: "r1", planId: "plan-sales", category: "membership", condition: "new_membership", percent: 20, flatCents: null },
    { id: "r2", planId: "plan-sales", category: "enrollment_fee", condition: "any", percent: 20, flatCents: null },
    { id: "r3", planId: "plan-sales", category: "pt_package", condition: "any", percent: 10, flatCents: null },
  ],
};
const trainers: CommissionPlan = {
  id: "plan-tr",
  name: "Trainers",
  defaultRoles: [],
  defaultTrainers: true,
  defaultEnabled: false,
  earnOn: "sale",
  rules: [{ id: "r4", planId: "plan-tr", category: "pt_package", condition: "any", percent: 10, flatCents: null }],
};
const people = new Map([
  ["kim", { id: "kim", role: "sales", isTrainer: false }],
  ["tom", { id: "tom", role: "staff", isTrainer: true }],
]);

function line(over: Partial<PosCommissionInput>): PosCommissionInput {
  return {
    lineId: "l1",
    saleId: "s1",
    saleNumber: 1,
    saleAt: "2026-11-12T15:00:00Z",
    clientName: "A Member",
    description: "Item",
    category: "membership",
    quantity: 1,
    totalCents: 23707,
    taxCents: 1807,
    credits: [{ staffId: "kim", share: 100 }],
    noCommission: false,
    frozenMember: false,
    isNewPtClient: true,
    ...over,
  };
}

describe("commissionCategoryFor", () => {
  it("maps POS revenue categories", () => {
    expect(commissionCategoryFor("membership_dues")).toBe("membership");
    expect(commissionCategoryFor("registration_fee")).toBe("enrollment_fee");
    expect(commissionCategoryFor("personal_training")).toBe("pt_package");
    expect(commissionCategoryFor("pilates")).toBe("other");
    expect(commissionCategoryFor("drinks")).toBe("retail");
    expect(commissionCategoryFor(null)).toBe("none");
  });
});

describe("posCommissions", () => {
  it("pays on the pre-tax amount", () => {
    const [row] = posCommissions([line({})], [sales, trainers], people, new Map());
    expect(row.baseCents).toBe(21900);
    expect(row.amountCents).toBe(4380);
    expect(row.rule).toBe("20%");
  });
  it("splits by share", () => {
    const rows = posCommissions(
      [
        line({
          category: "pt_package",
          totalCents: 50000,
          taxCents: 0,
          credits: [
            { staffId: "kim", share: 50 },
            { staffId: "tom", share: 50 },
          ],
        }),
      ],
      [sales, trainers],
      people,
      new Map([["tom", { planId: null, enabled: true }]]),
    );
    expect(rows.map((r) => [r.staffId, r.amountCents])).toEqual([
      ["kim", 2500],
      ["tom", 2500],
    ]);
  });
  it("skips people whose commission is off, None, and frozen members' memberships", () => {
    expect(
      posCommissions([line({ credits: [{ staffId: "tom", share: 100 }], category: "pt_package" })], [sales, trainers], people, new Map()),
    ).toEqual([]);
    expect(posCommissions([line({ noCommission: true })], [sales], people, new Map())).toEqual([]);
    expect(posCommissions([line({ frozenMember: true })], [sales], people, new Map())).toEqual([]);
  });
});
