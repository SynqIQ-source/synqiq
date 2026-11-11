import { describe, expect, it } from "vitest";
import { DEFAULT_REVENUE_CATEGORIES, guessRevenueCategory, isExcludedFromCatalog, isTaxable } from "@/lib/pos/catalog";

describe("revenue categories", () => {
  it("has The Preserve's nine categories with the right tax", () => {
    const taxed = Object.fromEntries(DEFAULT_REVENUE_CATEGORIES.map((c) => [c.key, c.taxable]));
    expect(Object.keys(taxed)).toHaveLength(9);
    expect(taxed).toMatchObject({
      drinks: true,
      membership_dues: true,
      merchandise: true,
      nutritional: false,
      water: false,
      pilates: false,
      personal_training: false,
      gym_pass: false,
      registration_fee: false,
    });
  });

  it("decides tax by the item first, then its category", () => {
    expect(isTaxable({ taxable: null }, { taxable: true })).toBe(true);
    expect(isTaxable({ taxable: false }, { taxable: true })).toBe(false);
    expect(isTaxable({ taxable: true }, { taxable: false })).toBe(true);
    expect(isTaxable({ taxable: null }, null)).toBe(false);
  });
});

describe("first-guess categories for Mindbody items", () => {
  it("sorts retail products", () => {
    expect(guessRevenueCategory("product", "Celsius - Peach Mango Green Tea", null)).toBe("drinks");
    expect(guessRevenueCategory("product", "Vitamin Water - Squeezed Lemonade", null)).toBe("drinks");
    expect(guessRevenueCategory("product", "Essentia - 1 Liter", null)).toBe("water");
    expect(guessRevenueCategory("product", "Barebells - Salty Peanut", null)).toBe("nutritional");
    expect(guessRevenueCategory("product", "Hard Boiled Eggs- 2 pack", null)).toBe("nutritional");
    expect(guessRevenueCategory("product", "Preserve Hat (Black)", null)).toBe("merchandise");
    expect(guessRevenueCategory("product", "Registration Fee", null)).toBe("registration_fee");
  });
  it("sorts packs, services and memberships", () => {
    expect(guessRevenueCategory("service", "PT 60 16PK", "Personal Training · Personal Training")).toBe("personal_training");
    expect(guessRevenueCategory("service", "10 Pack Group Reformer", "Group Reformer · Group Reformer Classes")).toBe("pilates");
    expect(guessRevenueCategory("service", "Day Pass", "Memberships & Passes · Gym Passes")).toBe("gym_pass");
    expect(guessRevenueCategory("service", "Cycling Drop In", "Cycling · Group Class Fees")).toBe("gym_pass");
    expect(guessRevenueCategory("service", "No Show Fee", "Class Fees · Group Class Fees")).toBe("gym_pass");
    expect(guessRevenueCategory("service", "Assessment and Intro Workout", "Enrollment Appointments")).toBe("personal_training");
    expect(guessRevenueCategory("service", "Termination Fee (50% of remaining balance)", "Fee's")).toBe("membership_dues");
    expect(guessRevenueCategory("membership", "16 PT  (50)", "Membership")).toBe("personal_training");
    expect(guessRevenueCategory("membership", "Semi-Private PT 8", "Membership")).toBe("personal_training");
    expect(guessRevenueCategory("membership", "Unlimited Pilates Updated", "Membership")).toBe("pilates");
    expect(guessRevenueCategory("membership", "Adult Monthly Membership", "Membership")).toBe("membership_dues");
  });
  it("never imports dynamic pricing, cycle shoe rental or pool lanes", () => {
    expect(isExcludedFromCatalog("Dynamic Pricing")).toBe(true);
    expect(isExcludedFromCatalog("Cycle Shoe Rental")).toBe(true);
    expect(isExcludedFromCatalog("Unlimited Pool Lanes")).toBe(true);
    expect(isExcludedFromCatalog("Pool Lanes Access")).toBe(true);
    expect(isExcludedFromCatalog("Cycling Drop In")).toBe(false);
  });
});
