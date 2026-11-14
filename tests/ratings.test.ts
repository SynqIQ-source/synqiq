import { describe, expect, it } from "vitest";
import { cleanRating, firstVisitsByQuarter, pickToSend, quarterOf, score } from "@/lib/ratings/rules";

const zone = "America/Chicago";

describe("quarterOf", () => {
  it("uses calendar quarters in the studio's time zone", () => {
    expect(quarterOf("2026-11-13T15:00:00Z", zone)).toBe("2026-Q4");
    // 11 PM Mar 31 in Houston is still Q1 though it's April in UTC.
    expect(quarterOf("2026-04-01T04:00:00Z", zone)).toBe("2026-Q1");
    expect(quarterOf("2026-04-01T06:00:00Z", zone)).toBe("2026-Q2");
  });
});

describe("firstVisitsByQuarter", () => {
  it("keeps the first class with each instructor each quarter", () => {
    const visits = [
      { clientId: "a", staffId: "x", start: "2026-10-05T12:00:00Z", occurrenceId: "o2" },
      { clientId: "a", staffId: "x", start: "2026-10-02T12:00:00Z", occurrenceId: "o1" },
      { clientId: "a", staffId: "y", start: "2026-10-03T12:00:00Z", occurrenceId: "o3" },
      { clientId: "a", staffId: "x", start: "2027-01-05T12:00:00Z", occurrenceId: "o4" },
    ];
    expect(
      firstVisitsByQuarter(visits, zone)
        .map((v) => `${v.staffId}:${v.occurrenceId}:${v.quarter}`)
        .sort(),
    ).toEqual(["x:o1:2026-Q4", "x:o4:2027-Q1", "y:o3:2026-Q4"]);
  });
});

describe("pickToSend", () => {
  it("sends at most 2 a week per member, oldest class first", () => {
    const queued = [
      { id: 1, clientId: "a", classStart: "2026-11-03" },
      { id: 2, clientId: "a", classStart: "2026-11-01" },
      { id: 3, clientId: "a", classStart: "2026-11-02" },
      { id: 4, clientId: "b", classStart: "2026-11-02" },
    ];
    expect(pickToSend(queued, new Map()).map((r) => r.id)).toEqual([2, 3, 4]);
    expect(pickToSend(queued, new Map([["a", 1]])).map((r) => r.id)).toEqual([2, 4]);
    expect(pickToSend(queued, new Map([["a", 2]])).map((r) => r.id)).toEqual([4]);
  });
});

describe("score and cleanRating", () => {
  it("averages to two places", () => {
    expect(score([5, 4, 4])).toEqual({ average: 4.33, count: 3 });
    expect(score([])).toEqual({ average: null, count: 0 });
  });
  it("needs 1-5 whole stars; the comment is optional", () => {
    expect(cleanRating({ stars: 4, comment: "  Great  " })).toEqual({ stars: 4, comment: "Great" });
    expect(cleanRating({ stars: "5", comment: "" })).toEqual({ stars: 5, comment: null });
    expect("error" in cleanRating({ stars: 6, comment: null })).toBe(true);
    expect("error" in cleanRating({ stars: 2.5, comment: null })).toBe(true);
  });
});
