import { describe, expect, it } from "vitest";
import { billingDatesThrough, matchPracticeCharge, scheduleFromContract, termPaymentCount } from "@/lib/billing/practice";

describe("termPaymentCount", () => {
  it("counts payments before the end date (Mindbody's pattern)", () => {
    // 12 Month Commitment Jul 2 -> Jun 2: Jul..May = 11, renewal charges Jun 2.
    expect(termPaymentCount("2026-07-02", "2027-06-02")).toBe(11);
    // Pool lanes Aug 9 -> Aug 9: 12.
    expect(termPaymentCount("2026-08-09", "2027-08-09")).toBe(12);
    expect(termPaymentCount("2026-08-09", null)).toBeNull();
  });
});

describe("scheduleFromContract", () => {
  it("uses Mindbody's next bill amount and tax", () => {
    expect(
      scheduleFromContract(
        {
          startDate: "2026-07-02",
          endDate: "2027-06-02",
          autoRenewing: true,
          normalCents: 17900,
          nextSubtotalCents: 17900,
          nextTaxCents: 1477,
        },
        0.0825,
      ),
    ).toEqual({ firstBillDate: "2026-07-02", autopayCount: 11, autoRenews: true, subtotalCents: 17900, taxCents: 1477, totalCents: 19377 });
  });
});

describe("billingDatesThrough", () => {
  it("bills monthly from the start, into the renewal", () => {
    expect(billingDatesThrough("2026-07-02", 11, true, "2026-11-13")).toEqual([
      "2026-07-02",
      "2026-08-02",
      "2026-09-02",
      "2026-10-02",
      "2026-11-02",
    ]);
    expect(billingDatesThrough("2026-07-02", 11, true, "2027-07-02").slice(-2)).toEqual(["2027-06-02", "2027-07-02"]);
  });
  it("stops at the end when it doesn't renew", () => {
    expect(billingDatesThrough("2026-07-02", 2, false, "2027-01-01")).toEqual(["2026-07-02", "2026-08-02"]);
  });
  it("keeps the 31st", () => {
    expect(billingDatesThrough("2027-01-31", null, false, "2027-03-31")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
});

describe("matchPracticeCharge", () => {
  const charge = { dueDate: "2026-11-02", totalCents: 19377, contractIds: [15660], name: "12 Month Commitment" };
  const row = (day: string, totalCents = 19377, contractId: number | null = 15660, detailId = 1) => ({
    detailId,
    day,
    totalCents,
    description: "12 Month Commitment",
    contractId,
  });
  it("matches the same day and amount", () => {
    expect(matchPracticeCharge(charge, [row("2026-11-02")], "2026-11-13", new Set()).result).toBe("match");
  });
  it("a declined charge retried a few days later is the same charge", () => {
    expect(matchPracticeCharge(charge, [row("2026-11-05")], "2026-11-13", new Set()).result).toBe("date_differs");
  });
  it("flags a different amount", () => {
    expect(matchPracticeCharge(charge, [row("2026-11-02", 20000)], "2026-11-13", new Set()).result).toBe("amount_differs");
  });
  it("matches a renewal by name when the contract id changed", () => {
    expect(matchPracticeCharge(charge, [row("2026-11-02", 19377, 99999)], "2026-11-13", new Set()).result).toBe("match");
  });
  it("waits a week before saying Mindbody didn't charge", () => {
    expect(matchPracticeCharge(charge, [], "2026-11-05", new Set()).result).toBe("pending");
    expect(matchPracticeCharge(charge, [], "2026-11-10", new Set()).result).toBe("not_charged");
  });
  it("doesn't use one Mindbody charge twice", () => {
    expect(matchPracticeCharge(charge, [row("2026-11-02")], "2026-11-13", new Set([1])).result).toBe("not_charged");
  });
});
