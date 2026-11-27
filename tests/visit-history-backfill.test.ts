import { describe, expect, it } from "vitest";
import { backfillWindow } from "@/lib/sync/visit-history-backfill";

describe("all-time visit history window", () => {
  it("pulls from the year a member joined up to the stored history", () => {
    expect(backfillWindow("2019-06-25T00:00:00Z", "2026-01-01")).toEqual({ from: "2019-01-01", to: "2025-12-31" });
  });
  it("starts no earlier than 2015 when the join date is missing or older", () => {
    expect(backfillWindow(null, "2026-01-01")).toEqual({ from: "2015-01-01", to: "2025-12-31" });
    expect(backfillWindow("2010-03-01", "2026-01-01")).toEqual({ from: "2015-01-01", to: "2025-12-31" });
  });
  it("has nothing to pull for members who joined after the stored history began", () => {
    expect(backfillWindow("2026-03-10", "2026-01-01")).toBeNull();
  });
  it("stops before history already held from earlier years", () => {
    expect(backfillWindow("2018-02-01", "2024-01-01")).toEqual({ from: "2018-01-01", to: "2023-12-31" });
  });
});
