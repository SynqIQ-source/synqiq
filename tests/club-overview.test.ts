import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  byCategory,
  change,
  heatmap,
  maintenanceSummary,
  memberMovement,
  membersOn,
  periodsFor,
  type Adjustment,
  type Schedule,
} from "@/lib/dashboard/club-math";

const schedule = (change: Partial<Schedule>): Schedule => ({
  id: Math.random().toString(36),
  clientId: "c1",
  name: "Pat Member",
  membership: "Monthly",
  status: "active",
  startDate: "2026-10-01",
  endDate: null,
  createdDay: "2026-10-01",
  voided: false,
  ...change,
});
const adjustment = (change: Partial<Adjustment>): Adjustment => ({
  id: Math.random().toString(36),
  clientId: "c1",
  kind: "freeze",
  startsOn: "2026-11-05",
  endsOn: "2026-11-30",
  createdDay: "2026-11-04",
  cancelledDay: null,
  ...change,
});

describe("periodsFor", () => {
  it("compares to the same days of last month", () => {
    expect(periodsFor("2026-11-17")).toMatchObject({
      mtdFrom: "2026-11-01",
      priorFrom: "2026-10-01",
      priorTo: "2026-10-17",
      thirtyDaysAgo: "2026-10-18",
    });
  });
  it("clamps to the end of a shorter month", () => {
    expect(periodsFor("2026-03-31").priorTo).toBe("2026-02-28");
  });
});

describe("change", () => {
  it("gives the difference and percent", () => {
    expect(change(110, 100)).toEqual({ diff: 10, percent: 10 });
    expect(change(5, 0)).toEqual({ diff: 5, percent: null });
  });
});

describe("membersOn", () => {
  it("counts people once, and frozen ones apart from active", () => {
    const schedules = [schedule({ clientId: "a" }), schedule({ clientId: "a", membership: "Add-on" }), schedule({ clientId: "b" })];
    const result = membersOn(schedules, [adjustment({ clientId: "b" })], "2026-11-17", false);
    expect([...result.active]).toEqual(["a"]);
    expect([...result.frozen]).toEqual(["b"]);
  });

  it("drops cancellations once they take effect, and practice unless asked", () => {
    const schedules = [schedule({ clientId: "a" }), schedule({ clientId: "p", status: "practice" })];
    const cancels = [adjustment({ clientId: "a", kind: "cancel", startsOn: "2026-11-20", endsOn: null })];
    expect(membersOn(schedules, cancels, "2026-11-17", false).active.size).toBe(1);
    expect(membersOn(schedules, cancels, "2026-11-20", false).active.size).toBe(0);
    expect(membersOn(schedules, cancels, "2026-11-17", true).active.size).toBe(2);
  });

  it("ignores voided, not yet started and ended memberships", () => {
    const schedules = [
      schedule({ clientId: "v", voided: true }),
      schedule({ clientId: "f", startDate: "2026-12-01" }),
      schedule({ clientId: "e", endDate: "2026-11-10" }),
    ];
    expect(membersOn(schedules, [], "2026-11-17", false).active.size).toBe(0);
  });
});

describe("memberMovement", () => {
  it("counts cancellations by the day they were entered", () => {
    const cancels = [
      adjustment({ kind: "cancel", createdDay: "2026-11-03", startsOn: "2026-12-31", endsOn: null }),
      adjustment({ kind: "cancel", createdDay: "2026-10-28", startsOn: "2026-11-10", endsOn: null }),
    ];
    const result = memberMovement([], cancels, "2026-11-01", "2026-11-17", false);
    expect(result.cancelled).toHaveLength(1);
  });

  it("nets sold - cancelled - frozen + unfrozen", () => {
    const result = memberMovement(
      [schedule({ createdDay: "2026-11-02" }), schedule({ createdDay: "2026-11-09" }), schedule({ createdDay: "2026-10-30" })],
      [
        adjustment({ kind: "cancel", createdDay: "2026-11-05", endsOn: null }),
        adjustment({ startsOn: "2026-11-06", endsOn: "2026-12-06" }), // frozen this month
        adjustment({ startsOn: "2026-10-01", endsOn: "2026-11-09" }), // back on Nov 10
      ],
      "2026-11-01",
      "2026-11-17",
      false,
    );
    expect([result.sold.length, result.cancelled.length, result.frozen.length, result.unfrozen.length, result.net]).toEqual([
      2, 1, 1, 1, 1,
    ]);
  });

  it("a freeze taken back early counts as unfrozen; one taken back the day it was entered never happened", () => {
    const result = memberMovement(
      [],
      [
        adjustment({ startsOn: "2026-10-10", endsOn: "2026-12-31", cancelledDay: "2026-11-12", createdDay: "2026-10-09" }),
        adjustment({ startsOn: "2026-11-08", createdDay: "2026-11-07", cancelledDay: "2026-11-07" }),
      ],
      "2026-11-01",
      "2026-11-17",
      false,
    );
    expect(result.unfrozen).toHaveLength(1);
    expect(result.frozen).toHaveLength(0);
  });
});

describe("byCategory", () => {
  it("totals each revenue category, biggest first", () => {
    const lines = [
      { saleId: "1", day: "2026-11-01", category: "Retail", totalCents: 500 },
      { saleId: "2", day: "2026-11-01", category: "Membership dues", totalCents: 9900 },
      { saleId: "2", day: "2026-11-01", category: "Retail", totalCents: 700 },
    ];
    expect(byCategory(lines)).toEqual([
      { category: "Membership dues", cents: 9900 },
      { category: "Retail", cents: 1200 },
    ]);
  });
});

describe("heatmap", () => {
  it("places visits by weekday and hour, 6 AM to 9 PM", () => {
    const zone = "America/Chicago";
    const at = (local: string) => DateTime.fromISO(local, { zone }).toUTC().toISO()!;
    const { grid, outside, max } = heatmap(
      [at("2026-11-16T06:15"), at("2026-11-16T06:45"), at("2026-11-22T21:30"), at("2026-11-17T05:00")],
      zone,
    );
    expect(grid[0][0]).toBe(2); // Monday 6 AM
    expect(grid[15][6]).toBe(1); // Sunday 9 PM
    expect(outside).toBe(1);
    expect(max).toBe(2);
  });
});

describe("maintenanceSummary", () => {
  it("splits open reports into new and in progress, with average days down", () => {
    const now = DateTime.fromISO("2026-11-17T12:00:00Z");
    const result = maintenanceSummary(
      [
        { status: "reported", createdAt: "2026-11-15T12:00:00Z", resolvedAt: null },
        { status: "vendor_contacted", createdAt: "2026-11-13T12:00:00Z", resolvedAt: null },
        { status: "resolved", createdAt: "2026-11-01T12:00:00Z", resolvedAt: "2026-11-02T12:00:00Z" },
      ],
      now,
    );
    expect(result).toEqual({ downNew: 1, downInProgress: 1, avgDaysDown: 3 });
  });
});
