import type { StaffRole } from "@/lib/permissions";

// Time clock rules. Pure; unit-tested in tests/time-clock.test.ts.

// Clocking out signs out Staff and Sales (front desk, hourly). Instructors,
// trainers and Club Admins stay signed in (they use SynqIQ off the clock).
export function signsOutOnClockOut(staff: { role: StaffRole; isInstructor: boolean; isTrainer: boolean }): boolean {
  return (staff.role === "staff" || staff.role === "sales") && !staff.isInstructor && !staff.isTrainer;
}

export const MAX_SHIFT_HOURS = 16;
// An open shift older than this is probably a missed clock-out.
export const FORGOT_CLOCK_OUT_HOURS = 12;

export function shiftMinutes(clockIn: string, clockOut: string | null, now: Date): number {
  const end = clockOut ? Date.parse(clockOut) : now.getTime();
  return Math.max(0, Math.round((end - Date.parse(clockIn)) / 60_000));
}

export function forgotClockOut(clockIn: string, clockOut: string | null, now: Date): boolean {
  return !clockOut && now.getTime() - Date.parse(clockIn) > FORGOT_CLOCK_OUT_HOURS * 3_600_000;
}

// A Club Admin's added or edited shift. Returns the problem, or null.
export function shiftProblem(clockIn: string, clockOut: string | null, now: Date): string | null {
  const start = Date.parse(clockIn);
  if (Number.isNaN(start)) return "Enter a clock-in time.";
  if (start > now.getTime() + 5 * 60_000) return "Clock-in can't be in the future.";
  if (clockOut === null) return null;
  const end = Date.parse(clockOut);
  if (Number.isNaN(end)) return "Enter a clock-out time.";
  if (end <= start) return "Clock-out has to be after clock-in.";
  if (end > now.getTime() + 5 * 60_000) return "Clock-out can't be in the future.";
  if (end - start > MAX_SHIFT_HOURS * 3_600_000) return `A shift can be at most ${MAX_SHIFT_HOURS} hours.`;
  return null;
}

export type Punch = { id: string; staffId: string; clockIn: string; clockOut: string | null };

// Total minutes per person; open shifts count up to now.
export function totalsByStaff(punches: Punch[], now: Date): Map<string, { minutes: number; shifts: number; open: boolean }> {
  const totals = new Map<string, { minutes: number; shifts: number; open: boolean }>();
  for (const punch of punches) {
    const entry = totals.get(punch.staffId) ?? { minutes: 0, shifts: 0, open: false };
    entry.minutes += shiftMinutes(punch.clockIn, punch.clockOut, now);
    entry.shifts += 1;
    entry.open ||= !punch.clockOut;
    totals.set(punch.staffId, entry);
  }
  return totals;
}

export const hoursLabel = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
export const decimalHours = (minutes: number) => (Math.round((minutes / 60) * 100) / 100).toFixed(2);

// CSV for payroll: one line per shift.
export function punchesCsv(rows: { name: string; date: string; clockIn: string; clockOut: string; minutes: number }[]): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [["Staff", "Date", "Clock in", "Clock out", "Hours"].join(",")];
  for (const row of rows) lines.push([row.name, row.date, row.clockIn, row.clockOut, decimalHours(row.minutes)].map(cell).join(","));
  return `${lines.join("\n")}\n`;
}
