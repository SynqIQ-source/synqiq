import { describe, expect, it } from "vitest";
import {
  afterDecline,
  billingFlag,
  cardExpiry,
  cardNoticeDue,
  firstBillDate,
  firstPaymentParts,
  proratedCents,
} from "@/lib/billing/renewals";

describe("billing start", () => {
  it("bills on the sign-up day each month by default", () => {
    expect(firstBillDate("signup", "2026-11-21")).toBe("2026-12-21");
    expect(firstBillDate("signup", "2027-01-31")).toBe("2027-02-28");
  });

  it("prorated: drafts on the 1st of next month", () => {
    expect(firstBillDate("prorated", "2026-11-21")).toBe("2026-12-01");
    expect(firstBillDate("prorated", "2026-12-31")).toBe("2027-01-01");
    expect(firstBillDate("prorated", "2026-11-01")).toBe("2026-12-01");
  });

  it("prorates the rest of the month, sale day included", () => {
    expect(proratedCents(20000, "2026-11-21")).toBe(6667); // 10 of 30 days
    expect(proratedCents(20000, "2026-11-01")).toBe(20000);
    expect(proratedCents(20000, "2026-11-30")).toBe(667);
    expect(proratedCents(21900, "2027-02-15")).toBe(10950); // 14 of 28 days
  });

  it("prorates only the dues in the first payment", () => {
    const parts = [
      { label: "Registration", amountCents: 9900, recurring: false },
      { label: "Dues", amountCents: 21900, recurring: true },
    ];
    expect(firstPaymentParts(parts, "signup", "2026-11-21")).toBe(parts);
    expect(firstPaymentParts(parts, "prorated", "2026-11-21").map((part) => part.amountCents)).toEqual([9900, 7300]);
  });
});

describe("declined renewals", () => {
  it("retries 3, 6 and 10 days after the billing date, then freezes", () => {
    expect(afterDecline("2026-12-01", 1)).toEqual({ retryOn: "2026-12-04" });
    expect(afterDecline("2026-12-01", 2)).toEqual({ retryOn: "2026-12-07" });
    expect(afterDecline("2026-12-01", 3)).toEqual({ retryOn: "2026-12-11" });
    expect(afterDecline("2026-12-01", 4)).toEqual({ freeze: true });
  });
});

describe("expiring cards", () => {
  it("turns yellow a month before the card expires", () => {
    expect(cardExpiry(12, 2026, "2026-11-29").state).toBe("ok");
    expect(cardExpiry(12, 2026, "2026-11-30")).toEqual({
      state: "expiring",
      expiresOn: "2026-12-31",
      firstNoticeOn: "2026-11-30",
      secondNoticeOn: "2026-12-15",
    });
    expect(cardExpiry(12, 2026, "2027-01-01").state).toBe("expired");
  });

  it("emails when it turns yellow and again 15 days later", () => {
    const card = cardExpiry(12, 2026, "2026-11-30");
    expect(cardNoticeDue(card, { first: false, second: false }, "2026-11-30")).toBe("first");
    expect(cardNoticeDue(card, { first: true, second: false }, "2026-12-14", "2026-11-30")).toBeNull();
    expect(cardNoticeDue(card, { first: true, second: false }, "2026-12-15", "2026-11-30")).toBe("second");
    expect(cardNoticeDue(card, { first: true, second: true }, "2026-12-20", "2026-11-30")).toBeNull();
    expect(cardNoticeDue(cardExpiry(12, 2026, "2026-11-01"), { first: false, second: false }, "2026-11-01")).toBeNull();
  });

  it("flags red for a frozen membership, yellow for an expiring card", () => {
    const expiring = cardExpiry(12, 2026, "2026-12-05");
    expect(billingFlag({ frozen: true, card: expiring })).toBe("red");
    expect(billingFlag({ frozen: false, card: expiring })).toBe("yellow");
    expect(billingFlag({ frozen: false, card: cardExpiry(6, 2028, "2026-12-05") })).toBeNull();
    expect(billingFlag({ frozen: false, card: null })).toBeNull();
  });
});

describe("nightly renewal dates", () => {
  it("charges today's billing date and catches up a missed run, no further back", async () => {
    const { datesToCharge } = await import("@/lib/billing/renewals");
    expect(datesToCharge("2026-10-01", null, false, "2026-12-01")).toEqual(["2026-12-01"]);
    expect(datesToCharge("2026-10-01", null, false, "2026-12-03")).toEqual(["2026-12-01"]);
    expect(datesToCharge("2026-10-01", null, false, "2026-12-05")).toEqual([]);
    expect(datesToCharge("2026-12-01", null, false, "2026-11-30")).toEqual([]);
    expect(datesToCharge("2026-10-01", 2, false, "2026-12-01")).toEqual([]); // two payments: Oct, Nov
    expect(datesToCharge("2026-10-01", 2, true, "2026-12-01")).toEqual(["2026-12-01"]);
  });
});

describe("who must be named on a sale", () => {
  it("memberships and personal training need a buyer", async () => {
    const { needsBuyer } = await import("@/lib/pos/cart");
    expect(needsBuyer("membership", [])).toBe(true);
    expect(needsBuyer("service", ["personal_training"])).toBe(true);
    expect(needsBuyer("product", ["drinks"])).toBe(false);
  });
});

describe("renewal sales and decline emails", () => {
  it("splits a renewal into dues lines that add up exactly", async () => {
    const { renewalLines } = await import("@/lib/billing/renewal-sale");
    const lines = renewalLines(
      [
        { label: "Dues", revenueCategoryId: "c1", amountCents: 20000, taxable: true, taxCents: 1650 },
        { label: "Locker", revenueCategoryId: "c2", amountCents: 1900, taxable: false, taxCents: 0 },
      ],
      21900,
      1651,
    );
    expect(lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(21900);
    expect(lines.reduce((sum, line) => sum + line.taxCents, 0)).toBe(1651);
    expect(lines[0].taxCents).toBe(1651);
    expect(renewalLines([], 21900, 0)).toEqual([
      { label: "Monthly dues", revenueCategoryId: null, revenueCategory: null, amountCents: 21900, taxable: false, taxCents: 0 },
    ]);
  });

  it("tells the member booking is paused and when the card is retried", async () => {
    const { declinedPaymentEmail } = await import("@/lib/billing/notify");
    const first = declinedPaymentEmail({
      studioName: "The Preserve",
      firstName: "Sam",
      membership: "Monthly <Gold>",
      amountCents: 23707,
      card: "Visa ending 4242",
      retryOn: "2026-12-04",
    });
    expect(first.subject).toBe("Your The Preserve membership payment didn't go through");
    expect(first.html).toContain("Monthly &lt;Gold&gt;");
    expect(first.html).toContain("$237.07");
    expect(first.html).toContain("booking is paused");
    expect(first.html).toContain("Friday, December 4");
    const last = declinedPaymentEmail({
      studioName: "The Preserve",
      firstName: "",
      membership: "Gold",
      amountCents: 100,
      card: null,
      retryOn: null,
    });
    expect(last.subject).toBe("Your The Preserve membership is on hold");
    expect(last.html).not.toContain("try your card again");
  });
});
