import { describe, expect, it } from "vitest";
import { autoNumber, chooseSpot, cleanLayout, spotsOf, starterLayout, type RoomLayout } from "@/lib/rooms/layout";

const room: RoomLayout = {
  columns: 4,
  rows: 3,
  spotNoun: "Bike",
  items: [
    { id: "i", kind: "instructor", x: 1, y: 0, label: "" },
    { id: "a", kind: "spot", x: 0, y: 2, label: "1" },
    { id: "b", kind: "spot", x: 1, y: 2, label: "2" },
    { id: "c", kind: "spot", x: 2, y: 2, label: "3" },
  ],
};

describe("cleanLayout", () => {
  it("accepts a good layout", () => {
    expect(cleanLayout(room)).toEqual({ layout: room });
  });
  it("rejects two things in one square, items off the grid and duplicate spot names", () => {
    expect(cleanLayout({ ...room, items: [...room.items, { id: "d", kind: "door", x: 0, y: 2, label: "" }] })).toEqual({
      error: "Two things are in the same square.",
    });
    expect("error" in cleanLayout({ ...room, columns: 2 })).toBe(true);
    expect(cleanLayout({ ...room, items: [...room.items, { id: "d", kind: "spot", x: 3, y: 2, label: "1" }] })).toEqual({
      error: "Two spots are both called 1.",
    });
  });
});

describe("autoNumber", () => {
  it("numbers front to back, left to right", () => {
    const shuffled = { ...room, items: room.items.map((item) => (item.kind === "spot" ? { ...item, label: "x" + item.id } : item)) };
    expect(spotsOf(autoNumber(shuffled)).map((spot) => spot.label)).toEqual(["1", "2", "3"]);
  });
});

describe("starterLayout", () => {
  it("makes the asked number of spots plus the instructor", () => {
    const layout = starterLayout(20, "Bike");
    expect(spotsOf(layout)).toHaveLength(20);
    expect("layout" in cleanLayout(layout)).toBe(true);
  });
});

describe("chooseSpot", () => {
  it("gives the requested spot when free", () => {
    expect(chooseSpot(room, new Set(), "b").spot?.label).toBe("2");
    expect(chooseSpot(room, new Set(["b"]), "b").error).toMatch(/just taken/);
  });
  it("gives the lowest free spot when none is picked", () => {
    expect(chooseSpot(room, new Set(["a"]), null).spot?.label).toBe("2");
    expect(chooseSpot(room, new Set(["a", "b", "c"]), null).spot).toBeNull();
  });
});
