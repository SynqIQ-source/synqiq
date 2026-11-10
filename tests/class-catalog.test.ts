import { describe, expect, it } from "vitest";
import { htmlToText, isCurrentSchedule, toClassTypeRow, toProgramUpdate, toScheduleRow } from "@/lib/classes/catalog";

describe("class catalog import", () => {
  it("turns Mindbody's description HTML into plain text", () => {
    expect(
      htmlToText("<div>Paced one breath&nbsp;per movement.</div><p>Bring a mat &amp; water.</p><ul><li>Core</li><li>Balance</li></ul>"),
    ).toBe("Paced one breath per movement.\nBring a mat & water.\n• Core\n• Balance");
    expect(htmlToText("<p> </p>")).toBeNull();
  });

  it("reads booking rules the way Mindbody stores them", () => {
    expect(
      toProgramUpdate({ Id: 25, Name: "Pool Lanes", ScheduleType: "Class", CancelOffset: 120, ScheduleOffset: 5, ScheduleOffsetEnd: 21 }),
    ).toMatchObject({
      cancel_window_minutes: 120,
      booking_closes_minutes: 5,
      booking_opens_days: 21,
    });
    expect(
      toProgramUpdate({
        Id: 2,
        Name: "Personal Training",
        ScheduleType: "Appointment",
        CancelOffset: 1440,
        ScheduleOffset: 2880,
        ScheduleOffsetEnd: 0,
      }),
    ).toMatchObject({ booking_closes_minutes: 2880, booking_opens_days: null });
  });

  it("reads a weekly schedule's days and times", () => {
    const row = toScheduleRow("org", {
      Id: 34,
      ClassDescription: { Id: 25, Name: "Pool Lanes" },
      DayTuesday: true,
      DayThursday: true,
      StartTime: "1899-12-30T05:00:00",
      EndTime: "1899-12-30T05:30:00",
      StartDate: "2017-11-05T00:00:00",
      EndDate: "2030-01-01T00:00:00",
      Staff: { Id: 100000039 },
    });
    expect(row).toMatchObject({
      days: [2, 4],
      start_time: "05:00:00",
      end_time: "05:30:00",
      start_date: "2017-11-05",
      staff_mindbody_id: 100000039,
    });
    expect(isCurrentSchedule(row, "2026-11-11")).toBe(true);
    expect(isCurrentSchedule({ start_date: "2017-01-01", end_date: "2025-01-01" }, "2026-11-11")).toBe(false);
  });

  it("keeps a class type's program, level and category", () => {
    expect(
      toClassTypeRow("org", {
        Id: 1,
        Name: "Vinyasa Flow",
        Active: false,
        Program: { Id: 22 },
        SessionType: { Id: 5 },
        Level: { Id: 1, Name: "All levels" },
        Category: "Yoga",
      }),
    ).toMatchObject({ active: false, mindbody_program_id: 22, mindbody_session_type_id: 5, level: "All levels", category: "Yoga" });
  });
});
