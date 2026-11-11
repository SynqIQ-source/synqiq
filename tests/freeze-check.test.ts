import { describe, expect, it } from "vitest";
import { FREEZE_NOTICE, isInForce } from "@/lib/memberships/freeze-check";

describe("freeze check", () => {
  it("treats a contract as in force between its start and end (or termination)", () => {
    const contract = { start_date: "2026-01-01", end_date: "2027-01-01", termination_date: null };
    expect(isInForce(contract, "2026-11-11")).toBe(true);
    expect(isInForce(contract, "2025-12-31")).toBe(false);
    expect(isInForce({ ...contract, termination_date: "2026-10-01" }, "2026-11-11")).toBe(false);
    expect(isInForce({ start_date: "2026-01-01T00:00:00.000Z", end_date: null }, "2026-11-11")).toBe(true);
  });
  it("tells staff to unfreeze instead of selling a new membership", () => {
    expect(FREEZE_NOTICE).toMatch(/unfreeze/);
    expect(FREEZE_NOTICE).toMatch(/doesn't earn commission/);
  });
});
