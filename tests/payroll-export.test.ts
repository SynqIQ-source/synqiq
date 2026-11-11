import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, payrollCsv, payrollRows } from "@/lib/payroll/export";
import type { PayrollPerson } from "@/lib/payroll/report";

const person: PayrollPerson = {
  staffId: "s",
  name: "Pat Example",
  hourly: { minutes: 600, rateCents: 1500, amountCents: 15000, shifts: 2 },
  classes: [
    {
      occurrenceId: "c1",
      startsAt: "2026-10-26T22:30:00Z",
      endsAt: "2026-10-26T23:15:00Z",
      name: "Cycling - Rhythm and Groove",
      heads: 9,
      rateName: "Cycle Class",
      amountCents: 5000,
    },
  ],
  sessions: [
    {
      appointmentId: 1,
      startsAt: "2026-10-27T15:00:00Z",
      endsAt: "2026-10-27T15:50:00Z",
      sessionType: "Personal Training 50min",
      client: "A. B",
      service: "PT 60 16PK",
      valueCents: 11000,
      estimated: false,
      noShow: false,
      rateName: "PT 65%",
      amountCents: 7150,
    },
    {
      appointmentId: 2,
      startsAt: "2026-11-06T21:00:00Z",
      endsAt: "2026-11-06T21:50:00Z",
      sessionType: "Personal Training 50min",
      client: "C. D",
      service: "PT 60 8PK",
      valueCents: 13000,
      estimated: false,
      noShow: false,
      rateName: "PT 65%",
      amountCents: 8450,
    },
  ],
  commissionCents: 12150,
  commissionLines: 3,
  totalCents: 15000 + 5000 + 7150 + 8450 + 12150,
  missingRates: [],
};

describe("payroll export", () => {
  it("uses the Mindbody export's columns and row shapes", () => {
    const rows = payrollRows([person], "America/Chicago", "6");
    expect(rows[0]).toEqual(["NA", "6", "", "Pat Example", "Commission", "", "", "", "", "", "121.50", ""]);
    expect(rows[1]).toEqual(["NA", "6", "", "Pat Example", "Hourly Pay", "", "", "", "", "", "150.00", ""]);
    expect(rows[2]).toEqual([
      "",
      "6",
      "",
      "Pat Example",
      "Cycling - Rhythm and Groove",
      "10/26/2026",
      "Monday",
      "5:30 PM",
      "6:15 PM",
      9,
      "50.00",
      "",
    ]);
    // Sessions roll up to one row per session type, dated at the last session.
    expect(rows[3]).toEqual([
      "",
      "6",
      "",
      "Pat Example",
      "Personal Training 50min",
      "11/6/2026",
      "Friday",
      "3:00 PM",
      "3:50 PM",
      2,
      "156.00",
      "",
    ]);
    const csv = payrollCsv([person], "America/Chicago", "6").split("\r\n");
    expect(csv[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(csv).toHaveLength(5);
  });
});
