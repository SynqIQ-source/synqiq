import { describe, expect, it } from "vitest";
import { appointmentPayCents, classPayCents, describeRate, rateProblem, resolveRate, type PayRate } from "@/lib/payroll/rates";

const rate = (overrides: Partial<PayRate>): PayRate => ({
  id: "r",
  name: "r",
  appliesTo: "class",
  method: "class_formula",
  baseCents: 0,
  perHeadCents: 0,
  headsAbove: 0,
  capCents: null,
  percent: null,
  flatCents: null,
  ...overrides,
});

// Numbers from The Preserve's Oct 24 - Nov 6, 2026 Mindbody payroll report.
const peak = rate({ baseCents: 4000, perHeadCents: 500, headsAbove: 6, capCents: 7500 });
const nonPeak = rate({ baseCents: 4000, perHeadCents: 500, headsAbove: 4, capCents: 7500 });
const pilates50 = rate({ baseCents: 5000, perHeadCents: 750, headsAbove: 2, capCents: 10250 });

describe("class pay", () => {
  it("matches Peak Incentive", () => {
    expect(classPayCents(peak, 3)).toBe(4000);
    expect(classPayCents(peak, 6)).toBe(4000);
    expect(classPayCents(peak, 7)).toBe(4500);
    expect(classPayCents(peak, 12)).toBe(7000);
    expect(classPayCents(peak, 13)).toBe(7500);
    expect(classPayCents(peak, 21)).toBe(7500);
  });
  it("matches Non-Peak Incentive", () => {
    expect(classPayCents(nonPeak, 1)).toBe(4000);
    expect(classPayCents(nonPeak, 5)).toBe(4500);
    expect(classPayCents(nonPeak, 11)).toBe(7500);
    expect(classPayCents(nonPeak, 14)).toBe(7500);
  });
  it("matches Group Pilates with a $50 base", () => {
    expect(classPayCents(pilates50, 2)).toBe(5000);
    expect(classPayCents(pilates50, 4)).toBe(6500);
    expect(classPayCents(pilates50, 10)).toBe(10250);
    expect(classPayCents(pilates50, 12)).toBe(10250);
  });
  it("matches Group Pilates with a $35 base, capped at $95", () => {
    const pilates35 = rate({ baseCents: 3500, perHeadCents: 750, headsAbove: 2, capCents: 9500, noRegistrationCents: 3500 });
    expect(classPayCents(pilates35, 9)).toBe(8750);
    expect(classPayCents(pilates35, 10)).toBe(9500);
    expect(classPayCents(pilates35, 12)).toBe(9500);
  });
  it("pays the no-registrations rate when nobody came", () => {
    const pilates50 = rate({ baseCents: 5000, perHeadCents: 750, headsAbove: 2, capCents: 11000, noRegistrationCents: 3500 });
    expect(classPayCents(pilates50, 0)).toBe(3500);
    expect(classPayCents(pilates50, 1)).toBe(5000);
    expect(classPayCents(rate({ method: "flat", flatCents: 7500, noRegistrationCents: 4000 }), 0)).toBe(4000);
    expect(classPayCents(peak, 0)).toBe(4000); // no override set: normal formula
  });
  it("pays a flat class rate whatever the headcount", () => {
    expect(classPayCents(rate({ method: "flat", flatCents: 3000 }), 13)).toBe(3000);
    expect(classPayCents(rate({ baseCents: 5000 }), 9)).toBe(5000);
  });
});

describe("session pay", () => {
  it("pays a percent of the session's value", () => {
    const pct = rate({ appliesTo: "appointment", method: "percent", percent: 65 });
    expect(appointmentPayCents(pct, 11000)).toBe(7150);
    expect(appointmentPayCents(pct, 9050)).toBe(5883); // 58.825 rounds to 58.83
    expect(appointmentPayCents(pct, 0)).toBe(0); // comp session
  });
  it("pays a flat amount per session", () => {
    const flat = rate({ appliesTo: "appointment", method: "flat", flatCents: 3000 });
    expect(appointmentPayCents(flat, 11000)).toBe(3000);
    expect(appointmentPayCents(flat, 0)).toBe(3000);
  });
});

describe("picking the rate", () => {
  const assignments = [
    { scope: "class_type", mindbodyId: 10, payRateId: "type" },
    { scope: "class_schedule", mindbodyId: 500, payRateId: "schedule" },
  ];
  it("uses the schedule, then the class type, then the default", () => {
    const candidates = (schedule: number, type: number) => [
      { scope: "class_schedule", mindbodyId: schedule },
      { scope: "class_type", mindbodyId: type },
    ];
    expect(resolveRate(assignments, candidates(500, 10), "default")).toBe("schedule");
    expect(resolveRate(assignments, candidates(501, 10), "default")).toBe("type");
    expect(resolveRate(assignments, candidates(501, 11), "default")).toBe("default");
    expect(resolveRate([], candidates(501, 11), null)).toBeNull();
  });
});

describe("validation and labels", () => {
  const ok = {
    name: "Peak",
    appliesTo: "class",
    method: "class_formula",
    baseCents: 4000,
    perHeadCents: 500,
    headsAbove: 6,
    capCents: 7500,
    percent: null,
    flatCents: null,
  };
  it("accepts a good rate and rejects bad ones", () => {
    expect(rateProblem(ok)).toBeNull();
    expect(rateProblem({ ...ok, name: " " })).toMatch(/name/);
    expect(rateProblem({ ...ok, capCents: 1000 })).toMatch(/cap/);
    expect(rateProblem({ ...ok, method: "percent" })).toMatch(/formula or a flat/);
    expect(rateProblem({ ...ok, appliesTo: "appointment", method: "percent", percent: 0 })).toMatch(/percent/);
    expect(rateProblem({ ...ok, appliesTo: "appointment", method: "percent", percent: 65 })).toBeNull();
  });
  it("describes rates in plain words", () => {
    expect(describeRate(peak)).toBe("$40 + $5 per person above 6, up to $75");
    expect(describeRate(pilates50)).toBe("$50 + $7.50 per person above 2, up to $102.50");
    expect(describeRate(rate({ appliesTo: "appointment", method: "percent", percent: 65 }))).toBe("65% of the session's value");
    expect(describeRate(rate({ appliesTo: "appointment", method: "flat", flatCents: 3000 }))).toBe("$30 per session");
  });
});
