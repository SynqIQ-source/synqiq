import { describe, expect, it } from "vitest";
import { compareWithMindbody, generateSessions, type CalendarSchedule } from "@/lib/classes/calendar";
import { validateNew } from "@/lib/classes/catalog-edits";

const TZ = "America/Chicago";
const schedule = (fields: Partial<CalendarSchedule> = {}): CalendarSchedule => ({
  id: "s1",
  classTypeId: "t1",
  className: "Svelte",
  days: [1, 3], // Mon, Wed
  startTime: "06:05:00",
  endTime: "06:50:00",
  startDate: "2017-01-01",
  endDate: "2030-01-01",
  frequencyInterval: 1,
  resourceId: 1,
  capacity: 12,
  staffMindbodyId: 5,
  mindbodyClassScheduleId: 34,
  ...fields,
});

describe("class calendar", () => {
  it("puts a weekly class on each matching day in the window, in studio time", () => {
    const sessions = generateSessions([schedule()], "2026-11-09", "2026-11-15", TZ);
    expect(sessions.map((session) => [session.local_date, session.starts_at])).toEqual([
      ["2026-11-09", "2026-11-09T12:05:00.000Z"], // Monday, CST = UTC-6
      ["2026-11-11", "2026-11-11T12:05:00.000Z"],
    ]);
  });

  it("follows daylight saving time", () => {
    const [summer] = generateSessions([schedule({ days: [1] })], "2027-03-15", "2027-03-15", TZ);
    expect(summer.starts_at).toBe("2027-03-15T11:05:00.000Z"); // CDT = UTC-5
  });

  it("respects first/last dates and every-other-week schedules", () => {
    expect(generateSessions([schedule({ startDate: "2026-11-11" })], "2026-11-09", "2026-11-15", TZ).map((s) => s.local_date)).toEqual([
      "2026-11-11",
    ]);
    expect(generateSessions([schedule({ endDate: "2026-11-10" })], "2026-11-09", "2026-11-15", TZ).map((s) => s.local_date)).toEqual([
      "2026-11-09",
    ]);
    const biweekly = generateSessions(
      [schedule({ days: [1], startDate: "2026-11-02", frequencyInterval: 2 })],
      "2026-11-02",
      "2026-11-30",
      TZ,
    );
    expect(biweekly.map((s) => s.local_date)).toEqual(["2026-11-02", "2026-11-16", "2026-11-30"]);
  });

  it("compares with Mindbody's classes that day", () => {
    const session = { mindbody_class_schedule_id: 34, starts_at: "2026-11-09T12:05:00.000Z", staff_mindbody_id: 5 };
    expect(compareWithMindbody(session, [{ scheduleId: 34, startsAt: "2026-11-09T12:05:00+00:00", staffMindbodyId: 5 }])).toBe("match");
    expect(compareWithMindbody(session, [{ scheduleId: 34, startsAt: "2026-11-09T12:05:00+00:00", staffMindbodyId: 9 }])).toBe(
      "instructor_differs",
    );
    expect(compareWithMindbody(session, [{ scheduleId: 34, startsAt: "2026-11-09T13:00:00+00:00", staffMindbodyId: 5 }])).toBe(
      "time_differs",
    );
    expect(compareWithMindbody(session, [])).toBe("only_synqiq");
    expect(compareWithMindbody({ ...session, mindbody_class_schedule_id: null }, [])).toBe("only_synqiq");
  });
});

describe("creating classes", () => {
  const today = "2026-11-11";
  const valid = {
    class_type_id: "0b9a6a2e-1d2c-4f7e-9a51-2a3b4c5d6e7f",
    days: [2, 4],
    start_time: "18:00",
    end_time: "18:45",
    capacity: 14,
    start_date: "2026-11-17",
  };
  it("accepts a new class time and normalizes it", () => {
    expect(validateNew("class_schedule", valid, today)).toMatchObject({
      ok: true,
      values: { start_time: "18:00:00", days: [2, 4], end_date: null },
    });
  });
  it("rejects bad class times", () => {
    expect(validateNew("class_schedule", { ...valid, end_time: "17:00" }, today)).toMatchObject({ ok: false });
    expect(validateNew("class_schedule", { ...valid, start_date: "2026-11-01" }, today)).toMatchObject({ ok: false });
    expect(validateNew("class_schedule", { ...valid, end_date: "2026-11-16" }, today)).toMatchObject({ ok: false });
    expect(validateNew("class_schedule", { ...valid, class_type_id: "x" }, today)).toMatchObject({ ok: false });
    expect(validateNew("class_schedule", { ...valid, capacity: null }, today)).toMatchObject({ ok: false });
  });
  it("needs a name and program for a class type", () => {
    expect(validateNew("class_type", { name: "Sunrise Flow", mindbody_program_id: 23 }, today)).toMatchObject({ ok: true });
    expect(validateNew("class_type", { name: "Sunrise Flow" }, today)).toMatchObject({ ok: false });
  });
});
