import { describe, expect, it } from "vitest";
import { computeCart, promoProblem, type CartLineInput } from "@/lib/pos/cart";
import { canCheckout, canDiscountAtCheckout } from "@/lib/permissions";
import { canVoidSale, endOfDaySummary } from "@/lib/pos/sales";

const line = (overrides: Partial<CartLineInput>): CartLineInput => ({
  key: "a",
  unitPriceCents: 1000,
  quantity: 1,
  taxable: false,
  categoryId: "cat",
  ...overrides,
});

describe("checkout math", () => {
  it("taxes only taxable items, after discounts", () => {
    const cart = computeCart(
      [line({ key: "drink", unitPriceCents: 350, quantity: 2, taxable: true }), line({ key: "bar", unitPriceCents: 399, taxable: false })],
      0.0825,
    );
    expect(cart.subtotalCents).toBe(1099);
    expect(cart.taxCents).toBe(58); // 8.25% of $7.00
    expect(cart.totalCents).toBe(1157);
  });
  it("applies manual discounts (percent or dollars) before tax", () => {
    const cart = computeCart([line({ unitPriceCents: 26900, taxable: true, manualDiscount: { kind: "percent", value: 10 } })], 0.0825);
    expect(cart.lines[0].manualDiscountCents).toBe(2690);
    expect(cart.lines[0].taxCents).toBe(1997); // 8.25% of $242.10
    const capped = computeCart([line({ manualDiscount: { kind: "amount", value: 5000 } })], 0);
    expect(capped.lines[0].netCents).toBe(0);
  });
  it("applies a percent promo code only to its categories", () => {
    const cart = computeCart(
      [line({ key: "fee", unitPriceCents: 20000, categoryId: "reg" }), line({ key: "pt", unitPriceCents: 54000, categoryId: "pt" })],
      0,
      {
        kind: "percent",
        percent: 100,
        amountCents: null,
        categoryIds: ["reg"],
      },
    );
    expect(cart.lines.map((l) => l.promoDiscountCents)).toEqual([20000, 0]);
    expect(cart.totalCents).toBe(54000);
  });
  it("spreads a dollar-off promo across eligible lines without going below zero", () => {
    const cart = computeCart([line({ key: "a", unitPriceCents: 3000 }), line({ key: "b", unitPriceCents: 1000 })], 0, {
      kind: "amount",
      percent: null,
      amountCents: 2000,
      categoryIds: null,
    });
    expect(cart.discountCents).toBe(2000);
    expect(cart.totalCents).toBe(2000);
    const tooBig = computeCart([line({ unitPriceCents: 500 })], 0, { kind: "amount", percent: null, amountCents: 2000, categoryIds: null });
    expect(tooBig.totalCents).toBe(0);
  });
});

describe("promo codes", () => {
  const promo = { active: true, starts_on: null, ends_on: null, max_uses: null, uses: 0 };
  it("checks dates, uses and active", () => {
    expect(promoProblem(promo, "2026-11-11")).toBeNull();
    expect(promoProblem({ ...promo, ends_on: "2026-11-10" }, "2026-11-11")).toMatch(/expired/);
    expect(promoProblem({ ...promo, starts_on: "2026-12-01" }, "2026-11-11")).toMatch(/yet/);
    expect(promoProblem({ ...promo, max_uses: 3, uses: 3 }, "2026-11-11")).toMatch(/used up/);
    expect(promoProblem({ ...promo, active: false }, "2026-11-11")).toMatch(/active/);
  });
});

describe("who can check out and discount", () => {
  const who = (
    role: "admin" | "sales_lead" | "sales" | "staff",
    tags: { isInstructor?: boolean; isTrainer?: boolean; canSell?: boolean } = {},
  ) => ({
    role,
    canSell: tags.canSell ?? false,
    isInstructor: tags.isInstructor ?? false,
    isTrainer: tags.isTrainer ?? false,
  });
  it("lets admins, sales, trainers and front desk check out, not instructor-only staff", () => {
    expect(canCheckout(who("admin"))).toBe(true);
    expect(canCheckout(who("sales"))).toBe(true);
    expect(canCheckout(who("staff", { isTrainer: true }))).toBe(true);
    expect(canCheckout(who("staff"))).toBe(true); // front desk
    expect(canCheckout(who("staff", { isInstructor: true }))).toBe(false);
    expect(canCheckout(who("staff", { isInstructor: true, isTrainer: true }))).toBe(true);
  });
  it("lets Sales and up discount, never trainers", () => {
    expect(canDiscountAtCheckout(who("sales"))).toBe(true);
    expect(canDiscountAtCheckout(who("sales_lead"))).toBe(true);
    expect(canDiscountAtCheckout(who("staff", { isTrainer: true }))).toBe(false);
    expect(canDiscountAtCheckout(who("staff"))).toBe(false);
  });
});

describe("voids and end of day", () => {
  const now = new Date("2026-11-11T20:00:00Z");
  it("lets managers void anything and staff void their own sale the same shift", () => {
    expect(canVoidSale({ id: "a", role: "admin" }, { staffId: "b", createdAt: "2026-10-01T00:00:00Z" }, now)).toBe(true);
    expect(canVoidSale({ id: "a", role: "sales_lead" }, { staffId: "b", createdAt: "2026-10-01T00:00:00Z" }, now)).toBe(true);
    expect(canVoidSale({ id: "a", role: "sales" }, { staffId: "a", createdAt: "2026-11-11T15:00:00Z" }, now)).toBe(true);
    expect(canVoidSale({ id: "a", role: "sales" }, { staffId: "a", createdAt: "2026-11-10T15:00:00Z" }, now)).toBe(false);
    expect(canVoidSale({ id: "a", role: "sales" }, { staffId: "b", createdAt: "2026-11-11T19:00:00Z" }, now)).toBe(false);
  });
  it("totals by payment, category and staff, leaving out voids", () => {
    const summary = endOfDaySummary([
      {
        status: "practice",
        paymentMethod: "practice",
        staffName: "Pat",
        totalCents: 42158,
        lines: [
          { revenueCategory: "Drinks", totalCents: 758, taxCents: 58, discountCents: 0 },
          { revenueCategory: "Personal Training", totalCents: 41400, taxCents: 0, discountCents: 4600 },
        ],
      },
      {
        status: "voided",
        paymentMethod: "practice",
        staffName: "Pat",
        totalCents: 999,
        lines: [{ revenueCategory: "Drinks", totalCents: 999, taxCents: 0, discountCents: 0 }],
      },
    ]);
    expect(summary).toMatchObject({ sales: 1, voided: 1, totalCents: 42158, taxCents: 58, discountCents: 4600 });
    expect(summary.byCategory).toEqual([
      { key: "Personal Training", count: 1, cents: 41400 },
      { key: "Drinks", count: 1, cents: 700 },
    ]);
    expect(summary.byStaff).toEqual([{ key: "Pat", count: 1, cents: 42158 }]);
  });
});
