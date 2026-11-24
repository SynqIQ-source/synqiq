import { describe, expect, it } from "vitest";
import { byPerson, classPaySplit, hourlyPayCents, packPosition, rateDetail } from "@/lib/payroll/details";
import type { PayRate } from "@/lib/payroll/rates";

const formula: PayRate = {
  id: "r",
  name: "Cycle",
  appliesTo: "class",
  method: "class_formula",
  baseCents: 4000,
  perHeadCents: 500,
  headsAbove: 6,
  capCents: 7500,
  percent: null,
  flatCents: null,
  noRegistrationCents: 2000,
};

describe("class pay: base and incentive bonus", () => {
  it("splits the per-person bonus above the people included in the base", () => {
    expect(classPaySplit(formula, 9, null)).toEqual({ baseCents: 4000, incentiveCents: 1500, amountCents: 5500 });
    expect(classPaySplit(formula, 6, null)).toEqual({ baseCents: 4000, incentiveCents: 0, amountCents: 4000 });
  });
  it("caps the bonus, and the sum always equals the class pay", () => {
    const split = classPaySplit(formula, 30, null);
    expect(split).toEqual({ baseCents: 4000, incentiveCents: 3500, amountCents: 7500 });
    expect(split.baseCents + split.incentiveCents).toBe(split.amountCents);
  });
  it("treats nobody-came pay, flat rates and pay set on the class as base", () => {
    expect(classPaySplit(formula, 0, null)).toEqual({ baseCents: 2000, incentiveCents: 0, amountCents: 2000 });
    expect(classPaySplit({ ...formula, method: "flat", flatCents: 3000 }, 12, null)).toEqual({
      baseCents: 3000,
      incentiveCents: 0,
      amountCents: 3000,
    });
    expect(classPaySplit(formula, 12, 6000)).toEqual({ baseCents: 6000, incentiveCents: 0, amountCents: 6000 });
    expect(classPaySplit(null, 12, null)).toEqual({ baseCents: 0, incentiveCents: 0, amountCents: 0 });
  });
  it("labels the rate", () => {
    expect(rateDetail(formula)).toBe("$40 + $5/person over 6, max $75");
    expect(rateDetail({ ...formula, appliesTo: "appointment", method: "percent", percent: 65 })).toBe("65%");
    expect(rateDetail({ ...formula, method: "flat", flatCents: 2050 })).toBe("$20.50 flat");
  });
});

describe("where a session falls in the client's package", () => {
  const visits = [
    { key: "1", start: "2026-11-01T10:00:00", usedSession: true },
    { key: "2", start: "2026-11-03T10:00:00", usedSession: false }, // cancelled in time
    { key: "3", start: "2026-11-05T10:00:00", usedSession: true },
    { key: "4", start: "2026-11-08T10:00:00", usedSession: true },
    { key: "0", start: "2026-10-01T10:00:00", usedSession: true }, // an older package
  ];
  it("counts the sessions used up to and including this one", () => {
    expect(packPosition(10, "2026-11-01", visits, { key: "3", start: "2026-11-05T10:00:00" })).toEqual({ used: 2, left: 8 });
    expect(packPosition(10, "2026-11-01", visits, { key: "4", start: "2026-11-08T10:00:00" })).toEqual({ used: 3, left: 7 });
  });
  it("never goes below zero left, and is unknown without a package size", () => {
    expect(packPosition(2, "2026-11-01", visits, { key: "4", start: "2026-11-08T10:00:00" })).toEqual({ used: 3, left: 0 });
    expect(packPosition(null, "2026-11-01", visits, { key: "4", start: "2026-11-08T10:00:00" })).toBeNull();
  });
});

describe("totals", () => {
  it("groups rows by person, sorted by name, with each total", () => {
    const groups = byPerson([
      { staffId: "b", staffName: "Bo", amountCents: 500 },
      { staffId: "a", staffName: "Al", amountCents: 700 },
      { staffId: "b", staffName: "Bo", amountCents: -200 },
    ]);
    expect(groups.map((g) => [g.staffName, g.rows.length, g.totalCents])).toEqual([
      ["Al", 1, 700],
      ["Bo", 2, 300],
    ]);
  });
  it("pays hours at the hourly rate to the cent", () => {
    expect(hourlyPayCents(600, 1500)).toBe(15000);
    expect(hourlyPayCents(95, 1725)).toBe(2731); // 1h35m at $17.25 = $27.3125
    expect(hourlyPayCents(95, null)).toBe(0);
  });
});
