import { describe, expect, it } from "vitest";
import { buildRoster, rosterCounts, rosterStatus } from "@/lib/classes/roster";

describe("class roster", () => {
  it("reads each visit's status", () => {
    expect(rosterStatus({ SignedIn: true })).toBe("checked_in");
    expect(rosterStatus({ SignedIn: false, Missed: true })).toBe("no_show");
    expect(rosterStatus({ LateCancelled: true, SignedIn: false })).toBe("late_cancel");
    expect(rosterStatus({})).toBe("booked");
  });

  it("keeps one row per client (best status) and sorts checked in first", () => {
    const roster = buildRoster(
      [
        { ClientUniqueId: 2, LateCancelled: true, ServiceName: "12 Month Commitment" },
        { ClientUniqueId: 2, SignedIn: true, ServiceName: "12 Month Commitment" },
        { ClientUniqueId: 1, WebSignup: true },
        { ClientUniqueId: 3, Missed: true },
        { ClientUniqueId: 4, LateCancelled: true },
      ],
      (visit) => `Client ${visit.ClientUniqueId}`,
    );
    expect(roster.map((entry) => [entry.name, entry.status])).toEqual([
      ["Client 2", "checked_in"],
      ["Client 1", "booked"],
      ["Client 3", "no_show"],
      ["Client 4", "late_cancel"],
    ]);
    expect(roster[1].bookedOnline).toBe(true);
    expect(rosterCounts(roster)).toMatchObject({ inClass: 3, checked_in: 1, late_cancel: 1 });
  });
});
