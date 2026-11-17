import { describe, expect, it } from "vitest";
import { computeOnHand, reorderNeed } from "@/lib/pos/stock";

describe("computeOnHand", () => {
  it("is unknown until the product is counted", () => {
    expect(computeOnHand([{ kind: "received", quantity: 12, at: "2026-11-10T10:00:00Z" }], []).onHand).toBeNull();
  });

  it("starts from the count, adds deliveries and takes off sales since", () => {
    const result = computeOnHand(
      [
        { kind: "count", quantity: 20, at: "2026-11-01T10:00:00Z" },
        { kind: "received", quantity: 12, at: "2026-11-05T10:00:00Z" },
      ],
      [
        { quantity: 3, at: "2026-11-03T10:00:00Z" },
        { quantity: 2, at: "2026-11-06T10:00:00Z" },
      ],
    );
    expect(result).toMatchObject({ onHand: 27, receivedSince: 12, soldSince: 5, countedQuantity: 20 });
  });

  it("a recount replaces everything before it", () => {
    const result = computeOnHand(
      [
        { kind: "count", quantity: 20, at: "2026-11-01T10:00:00Z" },
        { kind: "received", quantity: 12, at: "2026-11-05T10:00:00Z" },
        { kind: "count", quantity: 25, at: "2026-11-08T10:00:00Z" },
        { kind: "received", quantity: 6, at: "2026-11-09T10:00:00Z" },
      ],
      [
        { quantity: 4, at: "2026-11-07T10:00:00Z" },
        { quantity: 1, at: "2026-11-10T10:00:00Z" },
      ],
    );
    expect(result.onHand).toBe(30);
  });

  it("counts of zero are real counts", () => {
    expect(computeOnHand([{ kind: "count", quantity: 0, at: "2026-11-01T10:00:00Z" }], []).onHand).toBe(0);
  });
});

describe("reorderNeed", () => {
  it("flags at or below the reorder level and fills back to PAR", () => {
    expect(reorderNeed(4, 20, 5)).toEqual({ reorder: true, toOrder: 16 });
    expect(reorderNeed(5, 20, 5)).toEqual({ reorder: true, toOrder: 15 });
    expect(reorderNeed(6, 20, 5)).toEqual({ reorder: false, toOrder: null });
  });

  it("needs a count and a reorder level", () => {
    expect(reorderNeed(null, 20, 5).reorder).toBe(false);
    expect(reorderNeed(3, 20, null).reorder).toBe(false);
    expect(reorderNeed(3, null, 5)).toEqual({ reorder: true, toOrder: null });
  });
});
