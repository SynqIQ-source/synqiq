import { describe, expect, it } from "vitest";
import { computeCart } from "@/lib/pos/cart";
import {
  expandCartLines,
  monthlySchedule,
  packageProblem,
  scheduleTerms,
  splitCents,
  upcomingPaymentDates,
  type PricedPart,
} from "@/lib/pos/packages";

const TAX = 0.0825;
// The Preserve's 12 Month Commitment: $200 registration (untaxed) + $219 dues (taxed).
const twelveMonth: PricedPart[] = [
  { label: "Registration fee", revenueCategoryId: "reg", amountCents: 20000, recurring: false, taxable: false },
  { label: "Monthly dues", revenueCategoryId: "dues", amountCents: 21900, recurring: true, taxable: true },
];
const pkg = { priceCents: 41900, taxable: true, categoryId: "dues", parts: twelveMonth };

describe("membership packages", () => {
  it("splits the first payment into its revenue categories, matching Mindbody's $437.07", () => {
    const expanded = expandCartLines([{ key: "a", item: pkg, quantity: 3, manualDiscount: null }]);
    expect(expanded.map((line) => [line.categoryId, line.unitPriceCents, line.quantity])).toEqual([
      ["reg", 20000, 1],
      ["dues", 21900, 1],
    ]);
    const cart = computeCart(expanded, TAX);
    expect(cart.lines.map((line) => line.taxCents)).toEqual([0, 1807]);
    expect(cart.totalCents).toBe(43707);
  });

  it("the monthly payments are the dues only", () => {
    const schedule = monthlySchedule(twelveMonth, TAX, "2026-11-12")!;
    expect(schedule.subtotalCents).toBe(21900);
    expect(schedule.totalCents).toBe(23707);
    expect(schedule.lines.map((line) => line.label)).toEqual(["Monthly dues"]);
    expect(schedule.firstBillDate).toBe("2026-12-12");
    expect(monthlySchedule(twelveMonth, TAX, "2027-01-31")!.firstBillDate).toBe("2027-02-28");
  });

  it("a package with no recurring part has no schedule", () => {
    expect(monthlySchedule([{ ...twelveMonth[0] }], TAX, "2026-11-12")).toBeNull();
  });

  it("shares a package discount across its parts", () => {
    const percent = computeCart(
      expandCartLines([{ key: "a", item: pkg, quantity: 1, manualDiscount: { kind: "percent", value: 50 } }]),
      TAX,
    );
    expect(percent.lines.map((line) => line.netCents)).toEqual([10000, 10950]);
    const amount = computeCart(
      expandCartLines([{ key: "a", item: pkg, quantity: 1, manualDiscount: { kind: "amount", value: 4190 } }]),
      TAX,
    );
    expect(amount.discountCents).toBe(4190);
    expect(amount.lines.map((line) => line.manualDiscountCents)).toEqual([2000, 2190]);
  });

  it("leaves ordinary items alone", () => {
    const expanded = expandCartLines([
      { key: "b", item: { priceCents: 399, taxable: true, categoryId: "drinks", parts: null }, quantity: 2, manualDiscount: null },
    ]);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({ key: "b", parentKey: "b", part: null, quantity: 2, unitPriceCents: 399 });
  });

  it("checks that the parts add up to the price", () => {
    const ids = new Set(["reg", "dues"]);
    expect(packageProblem(twelveMonth, 41900, ids)).toBeNull();
    expect(packageProblem(twelveMonth, 40000, ids)).toMatch(/add up to \$419\.00/);
    expect(packageProblem([{ ...twelveMonth[0], revenueCategoryId: "nope" }], 20000, ids)).toMatch(/revenue category/);
    expect(packageProblem([{ ...twelveMonth[0], label: "" }], 20000, ids)).toMatch(/name/);
  });

  it("splits cents exactly", () => {
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitCents(4190, [20000, 21900]).reduce((a, b) => a + b, 0)).toBe(4190);
    expect(splitCents(5, [0, 0])).toEqual([5, 0]);
  });

  it("describes the terms", () => {
    expect(scheduleTerms(11, true)).toBe("11 more monthly payments, then month to month");
    expect(scheduleTerms(null, false)).toBe("monthly until cancelled");
    expect(scheduleTerms(1, false)).toBe("1 more monthly payment");
  });
});

describe("upcomingPaymentDates", () => {
  it("lists the next payments from the first bill date", () => {
    expect(upcomingPaymentDates("2026-12-12", 11, true, "2026-11-12")).toEqual([
      { date: "2026-12-12", number: 1, renewal: false },
      { date: "2027-01-12", number: 2, renewal: false },
      { date: "2027-02-12", number: 3, renewal: false },
    ]);
  });
  it("stops after the last payment when it doesn't renew", () => {
    expect(upcomingPaymentDates("2026-12-12", 2, false, "2027-01-01", 5).map((d) => d.date)).toEqual(["2027-01-12"]);
  });
  it("marks month-to-month payments after the term", () => {
    const dates = upcomingPaymentDates("2026-01-12", 11, true, "2026-11-20", 2);
    expect(dates).toEqual([
      { date: "2026-12-12", number: 12, renewal: true },
      { date: "2027-01-12", number: 13, renewal: true },
    ]);
  });
  it("keeps month ends", () => {
    expect(upcomingPaymentDates("2027-01-31", null, false, "2027-01-01", 3).map((d) => d.date)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });
});
