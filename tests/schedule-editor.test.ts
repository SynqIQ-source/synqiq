import { describe, expect, it } from "vitest";
import { dayBefore, findClashes, validateSeries } from "@/lib/classes/schedule-editor";
import { placeWithLimits } from "@/lib/booking/rules";
import { generateSessions } from "@/lib/classes/calendar";

const STAFF = "11111111-1111-1111-1111-111111111111";
const ASSIST = "22222222-2222-2222-2222-222222222222";
const ROOM = "33333333-3333-3333-3333-333333333333";
const today = "2026-11-20";
const base = {
  kind: "recurring",
  startDate: "2026-12-01",
  capacity: 20,
  rows: [{ days: [2, 4], startTime: "06:00", endTime: "06:45", staffId: STAFF, roomId: ROOM }],
};

describe("validateSeries", () => {
  it("needs no end date", () => {
    const result = validateSeries(base, today);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]).toMatchObject({ end_date: null, frequency_type: "Weekly", frequency_interval: 1, days: [2, 4] });
  });
  it("makes a single class a one-day series on that weekday", () => {
    const result = validateSeries({ ...base, kind: "single", endDate: "2027-01-01" }, today);
    expect(result.ok && result.rows[0]).toMatchObject({
      days: [2],
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      frequency_type: "Single",
    });
  });
  it("keeps one row per time and checks each", () => {
    const two = { ...base, rows: [...base.rows, { days: [6], startTime: "09:00", endTime: "08:00" }] };
    expect(validateSeries(two, today)).toEqual({ ok: false, error: "Time 2: The class has to end after it starts." });
  });
  it("rejects past starts, bad end dates and oversized online spots", () => {
    expect(validateSeries({ ...base, startDate: "2026-11-01" }, today).ok).toBe(false);
    expect(validateSeries({ ...base, endDate: "2026-11-30" }, today).ok).toBe(false);
    expect(validateSeries({ ...base, onlineCapacity: 25 }, today).ok).toBe(false);
  });
  it("turning off online booking means 0 online spots", () => {
    const result = validateSeries({ ...base, onlineBooking: false, onlineCapacity: 10 }, today);
    expect(result.ok && result.rows[0].online_capacity).toBe(0);
  });
  it("pays an assistant separately, including $0", () => {
    const result = validateSeries(
      { ...base, rows: [{ ...base.rows[0], assistantId: ASSIST, assistantPayCents: 0, payOverrideCents: 4500 }] },
      today,
    );
    expect(result.ok && result.rows[0]).toMatchObject({ assistant_staff_id: ASSIST, assistant_pay_cents: 0, pay_override_cents: 4500 });
    expect(validateSeries({ ...base, rows: [{ ...base.rows[0], assistantId: STAFF }] }, today).ok).toBe(false);
    expect(validateSeries({ ...base, rows: [{ ...base.rows[0], assistantPayCents: 1000 }] }, today).ok).toBe(false);
  });
  it("free wins over pay later", () => {
    const result = validateSeries({ ...base, isFree: true, payLater: true }, today);
    expect(result.ok && [result.rows[0].is_free, result.rows[0].pay_later]).toEqual([true, false]);
  });
  it("every 2 weeks skips the off weeks", () => {
    const sessions = generateSessions(
      [
        {
          id: "s",
          classTypeId: null,
          className: "Beat",
          days: [2],
          startTime: "06:00:00",
          endTime: "06:45:00",
          startDate: "2026-12-01",
          endDate: null,
          frequencyInterval: 2,
          resourceId: null,
          capacity: 20,
          staffMindbodyId: null,
          mindbodyClassScheduleId: null,
        },
      ],
      "2026-12-01",
      "2026-12-31",
      "America/Chicago",
    );
    expect(sessions.map((session) => session.local_date)).toEqual(["2026-12-01", "2026-12-15", "2026-12-29"]);
  });
});

describe("findClashes", () => {
  const busy = [
    { className: "Sculpt", localDate: "2026-12-01", startTime: "06:30:00", endTime: "07:15:00", roomId: ROOM, staffIds: [] },
    { className: "Yoga", localDate: "2026-12-01", startTime: "06:00:00", endTime: "06:30:00", roomId: null, staffIds: [ASSIST] },
  ];
  it("flags overlapping room or instructor, not back-to-back", () => {
    const clashes = findClashes(
      [{ localDate: "2026-12-01", startTime: "06:00:00", endTime: "06:45:00", roomId: ROOM, staffIds: [STAFF, ASSIST] }],
      busy,
    );
    expect(clashes.map((clash) => [clash.with, clash.reason])).toEqual([
      ["Sculpt", "room"],
      ["Yoga", "instructor"],
    ]);
    expect(
      findClashes([{ localDate: "2026-12-01", startTime: "07:15:00", endTime: "08:00:00", roomId: ROOM, staffIds: [] }], busy),
    ).toEqual([]);
  });
  it("dayBefore", () => expect(dayBefore("2027-01-01")).toBe("2026-12-31"));
});

describe("placeWithLimits", () => {
  const limits = { capacity: 10, taken: 0, waitlisted: 0, online: true, onlineCapacity: null, waitlistCapacity: null };
  it("matches the old rule when nothing is set", () => {
    expect(placeWithLimits(limits)).toBe("booked");
    expect(placeWithLimits({ ...limits, taken: 10 })).toBe("waitlisted");
  });
  it("online bookings stop at the online spots; staff can still fill the class", () => {
    expect(placeWithLimits({ ...limits, taken: 6, onlineCapacity: 6 })).toBe("waitlisted");
    expect(placeWithLimits({ ...limits, taken: 6, onlineCapacity: 6, online: false })).toBe("booked");
    expect(placeWithLimits({ ...limits, onlineCapacity: 0 })).toHaveProperty("error");
  });
  it("a full waitlist stops booking", () => {
    expect(placeWithLimits({ ...limits, taken: 10, waitlisted: 2, waitlistCapacity: 2 })).toEqual({
      error: "This class and its waitlist are full.",
    });
    expect(placeWithLimits({ ...limits, taken: 10, waitlistCapacity: 0 })).toEqual({ error: "This class is full." });
  });
});
