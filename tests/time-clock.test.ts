import { describe, expect, it } from "vitest";
import {
  decimalHours,
  forgotClockOut,
  hoursLabel,
  punchesCsv,
  shiftMinutes,
  shiftProblem,
  signsOutOnClockOut,
  totalsByStaff,
} from "@/lib/time-clock/hours";

const now = new Date("2026-11-11T20:00:00Z");

describe("time clock", () => {
  it("signs out Staff and Sales on clock-out; instructors, trainers and Club Admins stay signed in", () => {
    expect(signsOutOnClockOut({ role: "staff", isInstructor: false, isTrainer: false })).toBe(true);
    expect(signsOutOnClockOut({ role: "sales", isInstructor: false, isTrainer: false })).toBe(true);
    expect(signsOutOnClockOut({ role: "sales", isInstructor: true, isTrainer: false })).toBe(false);
    expect(signsOutOnClockOut({ role: "staff", isInstructor: false, isTrainer: true })).toBe(false);
    expect(signsOutOnClockOut({ role: "admin", isInstructor: false, isTrainer: false })).toBe(false);
  });

  it("counts minutes, open shifts up to now", () => {
    expect(shiftMinutes("2026-11-11T14:00:00Z", "2026-11-11T18:30:00Z", now)).toBe(270);
    expect(shiftMinutes("2026-11-11T19:15:00Z", null, now)).toBe(45);
    expect(forgotClockOut("2026-11-11T07:00:00Z", null, now)).toBe(true);
    expect(forgotClockOut("2026-11-11T09:00:00Z", null, now)).toBe(false);
  });

  it("checks Club Admin edits", () => {
    expect(shiftProblem("2026-11-11T14:00:00Z", "2026-11-11T13:00:00Z", now)).toMatch(/after/);
    expect(shiftProblem("2026-11-12T14:00:00Z", null, now)).toMatch(/future/);
    expect(shiftProblem("2026-11-10T01:00:00Z", "2026-11-10T20:00:00Z", now)).toMatch(/16 hours/);
    expect(shiftProblem("2026-11-11T14:00:00Z", "2026-11-11T18:00:00Z", now)).toBeNull();
  });

  it("totals per person and writes payroll CSV", () => {
    const totals = totalsByStaff(
      [
        { id: "1", staffId: "a", clockIn: "2026-11-10T14:00:00Z", clockOut: "2026-11-10T22:00:00Z" },
        { id: "2", staffId: "a", clockIn: "2026-11-11T19:00:00Z", clockOut: null },
      ],
      now,
    );
    expect(totals.get("a")).toEqual({ minutes: 540, shifts: 2, open: true });
    expect(hoursLabel(545)).toBe("9h 05m");
    expect(decimalHours(545)).toBe("9.08");
    expect(punchesCsv([{ name: "Smith, Jo", date: "2026-11-10", clockIn: "8:00 AM", clockOut: "4:00 PM", minutes: 480 }])).toBe(
      'Staff,Date,Clock in,Clock out,Hours\n"Smith, Jo",2026-11-10,8:00 AM,4:00 PM,8.00\n',
    );
  });
});
