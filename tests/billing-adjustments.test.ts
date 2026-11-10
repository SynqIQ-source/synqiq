import { describe, expect, it } from "vitest";
import { describeAdjustment, dollarsToCents, validateAdjustment } from "@/lib/memberships/adjustments";

const TODAY = "2026-11-10";
const base = { startsOn: "2026-11-15", reason: "Billing error last month" };

describe("validateAdjustment", () => {
  it("accepts a dues credit and drops any end date", () => {
    const result = validateAdjustment({ ...base, kind: "credit", amountCents: 5000, endsOn: "2026-12-01" }, TODAY);
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "credit",
        contractId: null,
        amountCents: 5000,
        percent: null,
        startsOn: "2026-11-15",
        endsOn: null,
        reason: "Billing error last month",
      },
    });
  });

  it("needs exactly one of $ or % for a discount", () => {
    expect(validateAdjustment({ ...base, kind: "discount_once", percent: 10 }, TODAY).ok).toBe(true);
    expect(
      validateAdjustment(
        {
          ...base,
          kind: "discount_ongoing",
          amountCents: 2500,
          endsOn: "2027-03-31",
        },
        TODAY,
      ).ok,
    ).toBe(true);
    expect(validateAdjustment({ ...base, kind: "discount_once" }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "discount_once", percent: 10, amountCents: 100 }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "discount_once", percent: 101 }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "discount_once", percent: 10.555 }, TODAY)).toMatchObject({ ok: false });
  });

  it("a freeze needs an end date, no amount, and at most a year", () => {
    expect(validateAdjustment({ ...base, kind: "freeze", endsOn: "2027-01-15" }, TODAY).ok).toBe(true);
    expect(validateAdjustment({ ...base, kind: "freeze" }, TODAY)).toMatchObject({ ok: false, error: "A freeze needs an end date." });
    expect(validateAdjustment({ ...base, kind: "freeze", endsOn: "2027-01-15", amountCents: 100 }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "freeze", endsOn: "2028-01-15" }, TODAY)).toMatchObject({ ok: false });
  });

  it("rejects past starts, bad dates, ends before starts, blank reasons, bad ids", () => {
    expect(validateAdjustment({ ...base, kind: "credit", amountCents: 100, startsOn: "2026-11-09" }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "credit", amountCents: 100, startsOn: "2026-02-30" }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "freeze", endsOn: "2026-11-14" }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "credit", amountCents: 100, reason: "   " }, TODAY)).toMatchObject({
      ok: false,
      error: "Add a reason.",
    });
    expect(validateAdjustment({ ...base, kind: "credit", amountCents: 100, contractId: "drop table" }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "credit", amountCents: 1.5 }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "refund", amountCents: 100 }, TODAY)).toMatchObject({ ok: false });
    expect(validateAdjustment({ ...base, kind: "credit", amountCents: 100, startsOn: TODAY }, TODAY).ok).toBe(true);
  });
});

describe("wording and money input", () => {
  it("describes edits", () => {
    expect(describeAdjustment({ kind: "credit", amountCents: 5000, percent: null })).toBe("Dues credit $50.00");
    expect(
      describeAdjustment({
        kind: "discount_ongoing",
        amountCents: null,
        percent: 10,
      }),
    ).toBe("Ongoing discount 10%");
    expect(describeAdjustment({ kind: "freeze", amountCents: null, percent: null })).toBe("Freeze");
  });

  it("turns typed dollars into cents", () => {
    expect(dollarsToCents("25")).toBe(2500);
    expect(dollarsToCents("$1,200.5")).toBe(120050);
    expect(dollarsToCents("0.07")).toBe(7);
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });
});
