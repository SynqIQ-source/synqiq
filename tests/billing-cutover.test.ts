import { describe, expect, it } from "vitest";
import { monthlyOnDay, planCutover, type CutoverContract } from "@/lib/billing/cutover";

const base: CutoverContract = {
  nextBillDate: "2026-12-06",
  endDate: "2027-09-06",
  autoRenewing: true,
  normalCents: 26900,
  nextSubtotalCents: 26900,
  nextTaxCents: 2219,
  upcoming: null,
};

describe("Jan 1 cutover plan", () => {
  it("keeps the member's day and takes Mindbody's first payment on/after the cutover", () => {
    const plan = planCutover(
      {
        ...base,
        upcoming: [
          { date: "2026-12-06", subtotalCents: 26900, taxCents: 2219, totalCents: 29119 },
          { date: "2027-01-06", subtotalCents: 26900, taxCents: 2219, totalCents: 29119 },
          { date: "2027-01-06", subtotalCents: 0, taxCents: 0, totalCents: 0 },
          { date: "2027-02-06", subtotalCents: 26900, taxCents: 2219, totalCents: 29119 },
        ],
      },
      "2027-01-01",
      0.0825,
    );
    expect(plan).toMatchObject({
      firstBillDate: "2027-01-06",
      billDay: 6,
      totalCents: 29119,
      basis: "mindbody_schedule",
      remainingPayments: null,
    });
  });

  it("counts the payments left on a commitment that doesn't renew", () => {
    const plan = planCutover(
      {
        ...base,
        autoRenewing: false,
        upcoming: [
          { date: "2027-01-20", subtotalCents: 19900, taxCents: 1642, totalCents: 21542 },
          { date: "2027-02-20", subtotalCents: 19900, taxCents: 1642, totalCents: 21542 },
          { date: "2027-03-20", totalCents: 0 },
        ],
      },
      "2027-01-01",
      0.0825,
    );
    expect(plan).toMatchObject({ firstBillDate: "2027-01-20", remainingPayments: 2, autoRenews: false });
  });

  it("steps a renewing contract monthly from its next bill day when Mindbody lists nothing after", () => {
    expect(planCutover({ ...base, nextBillDate: "2026-12-31" }, "2027-01-01", 0.0825)).toMatchObject({
      firstBillDate: "2027-01-31",
      billDay: 31,
      totalCents: 29119,
      basis: "monthly_from_next_bill",
    });
    expect(planCutover({ ...base, nextBillDate: "2026-11-30" }, "2027-01-01", 0.0825)).toMatchObject({ firstBillDate: "2027-01-30" });
  });

  it("leaves out what shouldn't bill", () => {
    expect(planCutover({ ...base, endDate: "2026-12-20", autoRenewing: false }, "2027-01-01", 0.0825)).toEqual({
      exclude: "Ends before the cutover",
    });
    expect(planCutover({ ...base, normalCents: 0, nextSubtotalCents: 0 }, "2027-01-01", 0.0825)).toEqual({ exclude: "$0 autopay" });
    expect(planCutover({ ...base, nextBillDate: null, endDate: null }, "2027-01-01", 0.0825)).toEqual({
      exclude: "No billing day in Mindbody",
    });
    expect(planCutover({ ...base, autoRenewing: false, upcoming: [] }, "2027-01-01", 0.0825)).toEqual({
      exclude: "No payments due after the cutover",
    });
  });

  it("assumes a renewing contract renews when Mindbody hasn't generated the next term yet", () => {
    expect(
      planCutover(
        { ...base, nextBillDate: null, endDate: "2026-11-14", startDate: "2025-11-14", normalCents: 19900 },
        "2027-01-01",
        0.0825,
      ),
    ).toMatchObject({ firstBillDate: "2027-01-14", billDay: 14, subtotalCents: 19900, taxCents: 1642, basis: "assumed_renewal" });
  });

  it("holds a late billing day at the month's end", () => {
    expect(monthlyOnDay("2027-01-31", 1, 31)).toBe("2027-02-28");
    expect(monthlyOnDay("2027-01-31", 2, 31)).toBe("2027-03-31");
  });
});
