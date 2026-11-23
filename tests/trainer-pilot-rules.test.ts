import { describe, expect, it } from "vitest";
import {
  payPercentFor,
  periodContaining,
  pickRate,
  placeConflicts,
  rateInputProblem,
  reconcile,
  sessionPayCents,
  sessionValueCents,
  targetPeriodStart,
  type DatedRate,
} from "@/lib/trainer/pilot-rules";

const rate = (patch: Partial<DatedRate>): DatedRate => ({
  id: "r",
  staffId: "t1",
  sessionTypeId: null,
  method: "percent",
  percentBp: 6500,
  flatCents: null,
  effectiveFrom: "2026-11-01",
  ...patch,
});

describe("session pay (whole cents, no floats)", () => {
  it("pays a percent of the session's value, rounded half up", () => {
    expect(sessionPayCents({ method: "percent", percentBp: 6500, flatCents: null }, 8750, 100)).toBe(5688); // 56.875 -> 56.88
    expect(sessionPayCents({ method: "percent", percentBp: 5500, flatCents: null }, 14000, 100)).toBe(7700);
  });
  it("pays a flat amount, and a comp ($0) session pays nothing on a percent rate", () => {
    expect(sessionPayCents({ method: "flat", percentBp: null, flatCents: 2000 }, null, 100)).toBe(2000);
    expect(sessionPayCents({ method: "percent", percentBp: 6500, flatCents: null }, 0, 100)).toBe(0);
  });
  it("scales no-shows and late cancels by the studio's percent; no rate pays 0", () => {
    expect(sessionPayCents({ method: "flat", percentBp: null, flatCents: 2000 }, null, 50)).toBe(1000);
    expect(sessionPayCents({ method: "flat", percentBp: null, flatCents: 2000 }, null, 0)).toBe(0);
    expect(sessionPayCents(null, 9000, 100)).toBe(0);
    const settings = { noShowPercent: 100, lateCancelPercent: 40 };
    expect(payPercentFor("completed", settings)).toBe(100);
    expect(payPercentFor("no_show", settings)).toBe(100);
    expect(payPercentFor("late_cancelled", settings)).toBe(40);
  });
});

describe("effective-dated rates (acceptance j)", () => {
  const rates = [
    rate({ id: "old", effectiveFrom: "2026-11-01", percentBp: 6000 }),
    rate({ id: "new", effectiveFrom: "2026-12-01", percentBp: 7000 }),
    rate({ id: "pt30", sessionTypeId: 25, effectiveFrom: "2026-11-15", method: "flat", percentBp: null, flatCents: 3000 }),
    rate({ id: "other", staffId: "t2", effectiveFrom: "2026-01-01" }),
  ];
  it("uses the rate in effect on the session's date, not today's", () => {
    expect(pickRate(rates, "t1", 10, "2026-11-20")?.id).toBe("old");
    expect(pickRate(rates, "t1", 10, "2026-12-02")?.id).toBe("new");
    expect(pickRate(rates, "t1", 10, "2026-10-30")).toBeNull();
  });
  it("prefers the session type's rate, else the trainer's default", () => {
    expect(pickRate(rates, "t1", 25, "2026-11-20")?.id).toBe("pt30");
    expect(pickRate(rates, "t1", 25, "2026-11-10")?.id).toBe("old");
    expect(pickRate(rates, "t2", null, "2026-11-10")?.id).toBe("other");
  });
  it("parses the admin's input without floating point", () => {
    expect(rateInputProblem({ method: "percent", percent: "62.5", flatDollars: "", effectiveFrom: "2026-12-01" })).toEqual({
      method: "percent",
      percentBp: 6250,
      flatCents: null,
      effectiveFrom: "2026-12-01",
    });
    expect(rateInputProblem({ method: "flat", percent: "", flatDollars: "20.05", effectiveFrom: "2026-12-01" })).toMatchObject({ flatCents: 2005 });
    expect(rateInputProblem({ method: "percent", percent: "101", flatDollars: "", effectiveFrom: "2026-12-01" })).toHaveProperty("error");
    expect(rateInputProblem({ method: "flat", percent: "", flatDollars: "1e3", effectiveFrom: "2026-12-01" })).toHaveProperty("error");
    expect(rateInputProblem({ method: "flat", percent: "", flatDollars: "20", effectiveFrom: "soon" })).toHaveProperty("error");
  });
});

describe("session value from a SynqIQ pack sale", () => {
  it("is the pre-tax amount divided by the sessions", () => {
    expect(sessionValueCents([{ totalCents: 151_550, taxCents: 11_550 }], 16)).toBe(8750); // $1,400 / 16
    expect(sessionValueCents([{ totalCents: 1000, taxCents: 0 }], 3)).toBe(333);
    expect(sessionValueCents([], 0)).toBeNull();
  });
});

describe("pay periods and locking (acceptance k)", () => {
  it("are two weeks, Saturday to Friday, from Oct 24", () => {
    expect(periodContaining("2026-10-24")).toEqual({ startsOn: "2026-10-24", endsOn: "2026-11-06" });
    expect(periodContaining("2026-11-23")).toEqual({ startsOn: "2026-11-21", endsOn: "2026-12-04" });
  });
  it("send a line whose period is locked to the next open one", () => {
    expect(targetPeriodStart("2026-11-10", new Set())).toBe("2026-11-07");
    expect(targetPeriodStart("2026-11-10", new Set(["2026-11-07"]))).toBe("2026-11-21");
    expect(targetPeriodStart("2026-11-10", new Set(["2026-11-07", "2026-11-21"]))).toBe("2026-12-05");
  });
});

describe("double-booking the room and the client (acceptance b)", () => {
  const slot = { startsAt: "2026-12-01T15:00:00Z", endsAt: "2026-12-01T15:50:00Z" };
  it("blocks the client being in two sessions at once", () => {
    expect(
      placeConflicts({ slot, roomBusy: [], clientBusy: [{ id: "x", startsAt: "2026-12-01T15:30:00Z", endsAt: "2026-12-01T16:20:00Z" }] }),
    ).toMatch(/client/);
  });
  it("blocks the room, except a shared semi-private slot; back-to-back is fine", () => {
    expect(placeConflicts({ slot, clientBusy: [], roomBusy: [{ id: "c", startsAt: "2026-12-01T14:30:00Z", endsAt: "2026-12-01T15:15:00Z" }] })).toMatch(/room/);
    expect(
      placeConflicts({ slot, clientBusy: [], roomBusy: [{ id: "s", startsAt: slot.startsAt, endsAt: slot.endsAt, sharedSlot: true }] }),
    ).toBeNull();
    expect(placeConflicts({ slot, clientBusy: [], roomBusy: [{ id: "b", startsAt: "2026-12-01T15:50:00Z", endsAt: "2026-12-01T16:40:00Z" }] })).toBeNull();
  });
});

describe("reconciliation with Mindbody (acceptance l)", () => {
  it("pairs by trainer, client and day, and lists what's only on one side", () => {
    const rows = reconcile(
      [
        { id: "s1", trainerId: "t1", clientId: "c1", date: "2026-11-21", status: "completed", sessionType: "PT 50" },
        { id: "s2", trainerId: "t1", clientId: "c2", date: "2026-11-21", status: "no_show", sessionType: "PT 50" },
        { id: "s3", trainerId: "t1", clientId: "c3", date: "2026-11-22", status: "completed", sessionType: "PT 50" },
      ],
      [
        { id: "m1", trainerId: "t1", clientId: "c1", date: "2026-11-21", status: "Completed", sessionType: "PT 50" },
        { id: "m2", trainerId: "t1", clientId: "c2", date: "2026-11-21", status: "Completed", sessionType: "PT 50" },
        { id: "m4", trainerId: "t1", clientId: "c4", date: "2026-11-22", status: "Arrived", sessionType: "PT 50" },
      ],
    );
    expect(rows.find((r) => r.kind === "match" && r.synq.id === "s1")).toMatchObject({ statusDiffers: false });
    expect(rows.find((r) => r.kind === "match" && r.synq.id === "s2")).toMatchObject({ statusDiffers: true });
    expect(rows.find((r) => r.kind === "synq_only")).toMatchObject({ synq: { id: "s3" } });
    expect(rows.find((r) => r.kind === "mindbody_only")).toMatchObject({ mindbody: { id: "m4" } });
  });
});
