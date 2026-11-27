import { describe, expect, it } from "vitest";
import { classCategory } from "@/lib/classes/visit-categories";

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
