import type { ServiceInfo } from "@/lib/checkin/eligibility";

// Booking rules for a class on SynqIQ's calendar: who can book when, what
// covers it, booked vs waitlisted, and late cancels. Pure; unit-tested in
// tests/booking-rules.test.ts.

export type ProgramRules = {
  name: string;
  includedInMembership: boolean;
  bookingOpensDays: number | null; // members can book this many days ahead
  bookingClosesMinutes: number | null; // online booking closes this long before start
  cancelWindowMinutes: number | null; // cancelling inside this is late
  lateCancelFeeCents: number;
};

export type SessionInfo = { startsAt: string; endsAt: string; capacity: number | null; active: boolean };

export type Coverage = { kind: "membership" | "pack" | "none"; name: string | null; serviceId: number | null };

const MINUTE = 60_000;

// Whether booking is open right now. Members follow the program's window;
// staff can book any time until the class ends (Mindbody: 365 days ahead),
// and up to a day after it with a reason (someone who came but wasn't
// booked) -- `overridable`.
export const STAFF_LATE_BOOKING_HOURS = 24;
export function bookingWindow(
  session: SessionInfo,
  rules: ProgramRules,
  now: Date,
  by: "staff" | "member",
): { open: true } | { open: false; reason: string; overridable?: boolean } {
  if (!session.active) return { open: false, reason: "This class is cancelled." };
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (now.getTime() >= end) {
    const overridable = by === "staff" && now.getTime() < end + STAFF_LATE_BOOKING_HOURS * 60 * MINUTE;
    return {
      open: false,
      reason: overridable ? "This class is over. Add a reason to add someone anyway." : "This class is over.",
      overridable,
    };
  }
  if (by === "staff") return { open: true };
  if (rules.bookingOpensDays && start - now.getTime() > rules.bookingOpensDays * 1440 * MINUTE) {
    return { open: false, reason: `Booking opens ${rules.bookingOpensDays} days before class.` };
  }
  if (rules.bookingClosesMinutes && start - now.getTime() < rules.bookingClosesMinutes * MINUTE) {
    return { open: false, reason: `Online booking closes ${rules.bookingClosesMinutes} minutes before class.` };
  }
  return { open: true };
}

// What pays for the spot: membership (if the program is included and they
// have a current membership service), else a current pack in the class's
// program with sessions left, else nothing.
export function bookingCoverage(input: {
  rules: ProgramRules;
  services: ServiceInfo[];
  membershipProgram: string; // e.g. "Memberships & Passes"
  date: string; // class date, YYYY-MM-DD
  hasCurrentMembership: boolean;
}): Coverage {
  const usable = (service: ServiceInfo, program: string) =>
    (service.program ?? "").toLowerCase() === program.toLowerCase() &&
    service.current !== false &&
    (!service.activeDate || service.activeDate <= input.date) &&
    (!service.expirationDate || service.expirationDate >= input.date) &&
    (service.remaining === null || service.remaining > 0);
  if (input.rules.includedInMembership && input.hasCurrentMembership) {
    const membership = input.services.find((service) => usable(service, input.membershipProgram));
    if (membership) return { kind: "membership", name: membership.name, serviceId: membership.id };
  }
  const pack = input.services
    .filter((service) => usable(service, input.rules.name))
    .sort((a, b) => (a.expirationDate ?? "9999").localeCompare(b.expirationDate ?? "9999"))[0];
  if (pack) return { kind: "pack", name: pack.name, serviceId: pack.id };
  return { kind: "none", name: null, serviceId: null };
}

// Booked or waitlisted: spots taken = Mindbody's bookings + SynqIQ's.
export function placeFor(session: SessionInfo, takenSpots: number): "booked" | "waitlisted" {
  if (session.capacity === null) return "booked";
  return takenSpots < session.capacity ? "booked" : "waitlisted";
}

// Cancelling now: on time, or late (inside the program's window, with its fee).
export function cancellationFor(
  session: SessionInfo,
  rules: ProgramRules,
  now: Date,
): { status: "cancelled" | "late_cancelled"; feeCents: number | null } {
  const start = Date.parse(session.startsAt);
  const late = Boolean(rules.cancelWindowMinutes) && start - now.getTime() < (rules.cancelWindowMinutes as number) * MINUTE;
  return late ? { status: "late_cancelled", feeCents: rules.lateCancelFeeCents || null } : { status: "cancelled", feeCents: null };
}

// Staff choose on time or late; with no choice the program's rule decides.
// Turning a late cancel into an on-time one (waiving it) needs canWaive.
// Waitlist spots are always cancelled without a fee.
export function decideCancel(input: {
  status: string;
  session: SessionInfo;
  rules: ProgramRules;
  now: Date;
  requested?: "on_time" | "late";
  canWaive: boolean;
}): { ok: true; status: "cancelled" | "late_cancelled"; feeCents: number | null; waived: boolean } | { ok: false; error: string } {
  if (!["booked", "waitlisted", "checked_in"].includes(input.status)) return { ok: false, error: "Already cancelled." };
  if (input.status === "waitlisted") return { ok: true, status: "cancelled", feeCents: null, waived: false };
  const byRule = cancellationFor(input.session, input.rules, input.now);
  if (input.requested === "late")
    return { ok: true, status: "late_cancelled", feeCents: input.rules.lateCancelFeeCents || null, waived: false };
  if (input.requested === "on_time" && byRule.status === "late_cancelled") {
    if (!input.canWaive) return { ok: false, error: "Only Club Admins and Sales Leads can waive a late cancel." };
    return { ok: true, status: "cancelled", feeCents: null, waived: true };
  }
  return { ok: true, status: byRule.status, feeCents: byRule.feeCents, waived: false };
}

export const BOOKING_LABELS = {
  booked: "Booked",
  waitlisted: "Waitlist",
  cancelled: "Cancelled",
  late_cancelled: "Late cancel",
  checked_in: "Checked in",
  no_show: "No-show",
} as const;
