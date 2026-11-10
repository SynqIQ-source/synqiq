import { describe, expect, it } from "vitest";
import {
  applyIncreases,
  increasedCents,
  matchesFilters,
  parseFilters,
  renderNotice,
  validateIncrease,
  type IncreaseCandidate,
  type IncreaseFilters,
} from "@/lib/memberships/price-increase";
import { previewIncrease } from "@/lib/memberships/price-increase-data";
import { expectedCharges } from "@/lib/memberships/shadow-billing";

const TODAY = "2026-11-10";
const NONE: IncreaseFilters = {
  originalStartFrom: null,
  originalStartTo: null,
  plans: [],
  priceMinCents: null,
  priceMaxCents: null,
};
const contract = (fields: Partial<IncreaseCandidate>): IncreaseCandidate => ({
  contractId: "c1",
  mindbodyClientContractId: 1,
  mindbodyClientId: "A",
  contractName: "Adult Monthly Membership",
  originalStartDate: "2019-03-01",
  startDate: "2026-03-01",
  endDate: null,
  autopayStatus: "Active",
  autoRenewing: false,
  normalAutopayCents: 27000,
  ...fields,
});

describe("which memberships an increase covers", () => {
  it("only memberships still billing", () => {
    expect(matchesFilters(contract({}), NONE, TODAY)).toBe(true);
    expect(matchesFilters(contract({ normalAutopayCents: 0 }), NONE, TODAY)).toBe(false);
    expect(matchesFilters(contract({ autopayStatus: "Terminated" }), NONE, TODAY)).toBe(false);
    expect(matchesFilters(contract({ endDate: "2026-10-31" }), NONE, TODAY)).toBe(false);
    expect(matchesFilters(contract({ endDate: "2026-10-31", autoRenewing: true }), NONE, TODAY)).toBe(true);
    expect(matchesFilters(contract({ autopayStatus: "Suspended" }), NONE, TODAY)).toBe(true);
  });

  it("filters by member-since range, plan and current dues", () => {
    const filters: IncreaseFilters = {
      originalStartFrom: "2018-01-01",
      originalStartTo: "2020-12-31",
      plans: ["Adult Monthly Membership"],
      priceMinCents: 25000,
      priceMaxCents: 30000,
    };
    expect(matchesFilters(contract({}), filters, TODAY)).toBe(true);
    expect(matchesFilters(contract({ originalStartDate: "2021-01-01" }), filters, TODAY)).toBe(false);
    expect(matchesFilters(contract({ originalStartDate: null, startDate: "2019-06-01" }), filters, TODAY)).toBe(true);
    expect(matchesFilters(contract({ contractName: "Couples" }), filters, TODAY)).toBe(false);
    expect(matchesFilters(contract({ normalAutopayCents: 30001 }), filters, TODAY)).toBe(false);
  });

  it("flags memberships already in a scheduled increase", () => {
    const rows = previewIncrease(
      [contract({}), contract({ contractId: "c2" })],
      [{ contractId: "c2", name: "2027" }],
      NONE,
      5,
      false,
      TODAY,
    );
    expect(rows.map((row) => [row.contractId, row.newCents, row.alreadyScheduled])).toEqual([
      ["c1", 28350, null],
      ["c2", 28350, "2027"],
    ]);
  });
});

describe("new prices", () => {
  it("raises by the percent, optionally rounding up to a dollar", () => {
    expect(increasedCents(27000, 5, false)).toBe(28350);
    expect(increasedCents(18999, 3.5, false)).toBe(19664);
    expect(increasedCents(18999, 3.5, true)).toBe(19700);
    expect(increasedCents(20000, 5, true)).toBe(21000);
  });

  it("scales upcoming charges from the start date on, per contract", () => {
    const increase = {
      id: "i1",
      contractId: "c1",
      effectiveOn: "2027-02-01",
      oldCents: 20000,
      newCents: 21000,
    };
    expect(applyIncreases(21650, "c1", "2027-01-15", [increase])).toEqual({
      cents: 21650,
      ids: [],
    });
    expect(applyIncreases(21650, "c1", "2027-02-15", [increase])).toEqual({
      cents: 22733,
      ids: ["i1"],
    });
    expect(applyIncreases(21650, "c2", "2027-02-15", [increase]).cents).toBe(21650);
    const charges = expectedCharges(
      [
        {
          contractId: "c1",
          mindbodyClientId: "A",
          contractName: "x",
          autopays: [
            { date: "2027-01-15", totalCents: 21650 },
            { date: "2027-02-15", totalCents: 21650 },
          ],
        },
      ],
      [],
      { from: "2027-01-01", to: "2027-03-01" },
      [increase],
    );
    expect(charges.map((charge) => [charge.cents, charge.baseCents, charge.adjustmentIds])).toEqual([
      [21650, 21650, []],
      [22733, 21650, ["i1"]],
    ]);
  });
});

describe("validation", () => {
  const ok = { name: "2027 dues", percent: 5, effectiveOn: "2027-02-01" };
  it("starts on or after the billing switch", () => {
    expect(validateIncrease(ok, "2027-02-01", TODAY).ok).toBe(true);
    expect(validateIncrease({ ...ok, effectiveOn: "2027-01-31" }, "2027-02-01", TODAY)).toMatchObject({ ok: false });
    expect(validateIncrease({ ...ok, effectiveOn: TODAY }, "2026-01-01", TODAY)).toMatchObject({ ok: false });
  });
  it("needs a name and a sensible percent", () => {
    expect(validateIncrease({ ...ok, name: " " }, "2027-02-01", TODAY)).toMatchObject({ ok: false });
    expect(validateIncrease({ ...ok, percent: 0 }, "2027-02-01", TODAY)).toMatchObject({ ok: false });
    expect(validateIncrease({ ...ok, percent: "5" }, "2027-02-01", TODAY)).toMatchObject({ ok: false });
    expect(validateIncrease({ ...ok, percent: 2.555 }, "2027-02-01", TODAY)).toMatchObject({ ok: false });
  });
  it("parses search filters", () => {
    expect(parseFilters({ plans: ["A", 3], priceMinCents: 100 })).toEqual({
      ok: true,
      value: {
        originalStartFrom: null,
        originalStartTo: null,
        plans: ["A"],
        priceMinCents: 100,
        priceMaxCents: null,
      },
    });
    expect(
      parseFilters({
        originalStartFrom: "2020-01-01",
        originalStartTo: "2019-01-01",
      }),
    ).toMatchObject({ ok: false });
    expect(parseFilters({ priceMinCents: -1 })).toMatchObject({ ok: false });
    expect(parseFilters({ priceMinCents: 500, priceMaxCents: 100 })).toMatchObject({ ok: false });
  });
});

describe("notice draft", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    const text = renderNotice("Hi {first_name}, {old_price} -> {new_price} on {effective_date}. {oops}", {
      first_name: "Pat",
      member_since: "Mar 1, 2019",
      effective_date: "Feb 1, 2027",
      plan: "Adult",
      old_price: "$270.00",
      new_price: "$283.50",
      studio_name: "The Preserve",
    });
    expect(text).toBe("Hi Pat, $270.00 -> $283.50 on Feb 1, 2027. {oops}");
  });
});

describe("tax on the base rate", async () => {
  const { contractTaxRate, taxOn, formatTaxRate } = await import("@/lib/memberships/tax");
  it("reads the rate from the next bill, else an autopay, else unknown", () => {
    expect(contractTaxRate({ nextBillSubtotalCents: 20000, nextBillTaxCents: 1650 })).toBe(0.0825);
    expect(
      contractTaxRate({
        nextBillSubtotalCents: null,
        nextBillTaxCents: null,
        autopays: [{ subtotalCents: 10000, taxCents: 825 }],
      }),
    ).toBe(0.0825);
    expect(contractTaxRate({ nextBillSubtotalCents: null, nextBillTaxCents: null })).toBeNull();
    expect(contractTaxRate({ nextBillSubtotalCents: 5000, nextBillTaxCents: 0 })).toBe(0);
  });
  it("computes and formats tax", () => {
    expect(taxOn(28350, 0.0825)).toBe(2339);
    expect(taxOn(28350, null)).toBeNull();
    expect(formatTaxRate(0.0825)).toBe("8.25%");
  });
});
