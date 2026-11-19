import { describe, expect, it } from "vitest";
import { dueForAutoCheckIn } from "@/lib/checkin/reservations";

const now = new Date("2026-11-18T17:00:00Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const reservation = (id: string, startIn: number, length = 60) => ({ id, startsAt: at(startIn), endsAt: at(startIn + length) });

describe("auto check-in to reservations at club check-in", () => {
  it("checks in reservations starting within the next 60 minutes", () => {
    const due = dueForAutoCheckIn([reservation("soon", 15), reservation("edge", 60), reservation("later", 61)], now);
    expect(due.map((row) => row.id)).toEqual(["soon", "edge"]);
  });

  it("includes a class already under way, not one that has ended", () => {
    const due = dueForAutoCheckIn([reservation("running", -20), reservation("over", -90, 60)], now);
    expect(due.map((row) => row.id)).toEqual(["running"]);
  });
});
