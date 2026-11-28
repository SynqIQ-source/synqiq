import { describe, expect, it } from "vitest";
import { categoryCount, classCategory } from "@/lib/classes/visit-categories";

describe("The Preserve's class categories", () => {
  it.each([
    ["Pool Lanes", "pool"],
    ["Reformer Pilates", "reformer"],
    ["Pilates HEAT", "reformer"],
    ["Cycling - Rhythm and Groove", "cycle"],
    ["R.I.D.E.", "cycle"],
    ["Monster Ride", "cycle"],
    ["Vinyasa", "yoga"],
    ["Restorative Yoga", "yoga"],
    [" Mat Fusion", "yoga"],
    ["Sunrise Yoga Flow", "yoga"],
    ["Svelte", "group_fitness"],
    ["Sculpt", "group_fitness"],
    ["The Yard Series- Gains", "group_fitness"],
    ["Hustle and Core", "group_fitness"],
    ["Pilates Mat", "group_fitness"],
    [null, "group_fitness"],
  ])("%s -> %s", (name, category) => {
    expect(classCategory(name)).toBe(category);
  });
});

describe("category totals", () => {
  it("pluralizes each kind", () => {
    expect(categoryCount(11, "yoga")).toBe("11 yoga classes");
    expect(categoryCount(1, "group_fitness")).toBe("1 group fitness class");
    expect(categoryCount(3, "pool")).toBe("3 pool visits");
    expect(categoryCount(1200, "check_in")).toBe("1,200 check-ins");
  });
});
