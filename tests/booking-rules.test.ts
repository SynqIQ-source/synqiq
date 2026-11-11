import { describe, expect, it } from "vitest";
import { bookingCoverage, bookingWindow, cancellationFor, decideCancel, placeFor, type ProgramRules } from "@/lib/booking/rules";
import type { ServiceInfo } from "@/lib/checkin/eligibility";

const gx: ProgramRules = {
  name: "Membership GX Classes",
  includedInMembership: true,
  bookingOpensDays: 21,
  bookingClosesMinutes: 30,
  cancelWindowMinutes: 60,
  lateCancelFeeCents: 0,
};
const reformer: ProgramRules = { ...gx, name: "Group Reformer", includedInMembership: false, cancelWindowMinutes: 240 };
const session = { startsAt: "2026-11-20T12:00:00.000Z", endsAt: "2026-11-20T12:45:00.000Z", capacity: 12, active: true };
const at = (iso: string) => new Date(iso);
const service = (fields: Partial<ServiceInfo>): ServiceInfo => ({
  id: 1,
  name: "12 Month Commitment",
  program: "Memberships & Passes",
  count: 999999,
  remaining: 999998,
  activeDate: "2026-11-02",
  expirationDate: "2026-12-02",
  current: true,
  ...fields,
});

describe("booking window", () => {
  it("members book from 21 days ahead until 30 minutes before", () => {
    expect(bookingWindow(session, gx, at("2026-10-29T12:00:00Z"), "member")).toMatchObject({ open: false });
    expect(bookingWindow(session, gx, at("2026-11-19T12:00:00Z"), "member")).toEqual({ open: true });
    expect(bookingWindow(session, gx, at("2026-11-20T11:45:00Z"), "member")).toMatchObject({ open: false });
  });
  it("staff can book any time until the class ends, never a cancelled class", () => {
    expect(bookingWindow(session, gx, at("2026-10-01T12:00:00Z"), "staff")).toEqual({ open: true });
    expect(bookingWindow(session, gx, at("2026-11-20T12:30:00Z"), "staff")).toEqual({ open: true });
    expect(bookingWindow(session, gx, at("2026-11-20T13:00:00Z"), "staff")).toMatchObject({ open: false });
    expect(bookingWindow({ ...session, active: false }, gx, at("2026-11-19T12:00:00Z"), "staff")).toMatchObject({ open: false });
  });
});

describe("what covers a booking", () => {
  const base = { membershipProgram: "Memberships & Passes", date: "2026-11-20", hasCurrentMembership: true };
  it("membership covers included programs", () => {
    expect(bookingCoverage({ ...base, rules: gx, services: [service({})] })).toEqual({
      kind: "membership",
      name: "12 Month Commitment",
      serviceId: 1,
    });
  });
  it("Reformer needs a Reformer pack even for members", () => {
    expect(bookingCoverage({ ...base, rules: reformer, services: [service({})] })).toMatchObject({ kind: "none" });
    const pack = service({
      id: 2,
      name: "Reformer 10 Pack",
      program: "Group Reformer",
      count: 10,
      remaining: 3,
      expirationDate: "2027-01-01",
    });
    expect(bookingCoverage({ ...base, rules: reformer, services: [service({}), pack] })).toEqual({
      kind: "pack",
      name: "Reformer 10 Pack",
      serviceId: 2,
    });
    expect(bookingCoverage({ ...base, rules: reformer, services: [{ ...pack, remaining: 0 }] })).toMatchObject({ kind: "none" });
  });
  it("no membership, no pack: nothing covers it", () => {
    expect(bookingCoverage({ ...base, hasCurrentMembership: false, rules: gx, services: [] })).toMatchObject({ kind: "none" });
  });
});

describe("spots and cancelling", () => {
  it("waitlists when Mindbody's + SynqIQ's bookings fill the class", () => {
    expect(placeFor(session, 11)).toBe("booked");
    expect(placeFor(session, 12)).toBe("waitlisted");
    expect(placeFor({ ...session, capacity: null }, 50)).toBe("booked");
  });
  it("cancelling inside the window is late, with the program's fee", () => {
    expect(cancellationFor(session, gx, at("2026-11-20T10:00:00Z"))).toEqual({ status: "cancelled", feeCents: null });
    expect(cancellationFor(session, gx, at("2026-11-20T11:30:00Z"))).toEqual({ status: "late_cancelled", feeCents: null });
    expect(cancellationFor(session, { ...gx, cancelWindowMinutes: 120, lateCancelFeeCents: 2000 }, at("2026-11-20T11:00:00Z"))).toEqual({
      status: "late_cancelled",
      feeCents: 2000,
    });
  });
});

describe("staff cancel choice", () => {
  const pool = { ...gx, name: "Pool Lanes", lateCancelFeeCents: 2000 };
  const early = at("2026-11-20T09:00:00Z");
  const inside = at("2026-11-20T11:30:00Z");
  it("follows the program's rule when staff don't choose", () => {
    expect(decideCancel({ status: "booked", session, rules: pool, now: early, canWaive: false })).toMatchObject({
      ok: true,
      status: "cancelled",
    });
    expect(decideCancel({ status: "booked", session, rules: pool, now: inside, canWaive: false })).toMatchObject({
      ok: true,
      status: "late_cancelled",
      feeCents: 2000,
    });
  });
  it("anyone can mark an early cancel late; only managers can waive a late one", () => {
    expect(decideCancel({ status: "booked", session, rules: pool, now: early, requested: "late", canWaive: false })).toMatchObject({
      status: "late_cancelled",
      feeCents: 2000,
    });
    expect(decideCancel({ status: "booked", session, rules: pool, now: inside, requested: "on_time", canWaive: false })).toMatchObject({
      ok: false,
    });
    expect(decideCancel({ status: "booked", session, rules: pool, now: inside, requested: "on_time", canWaive: true })).toEqual({
      ok: true,
      status: "cancelled",
      feeCents: null,
      waived: true,
    });
  });
  it("waitlist spots cancel without a fee; cancelled bookings can't cancel again", () => {
    expect(decideCancel({ status: "waitlisted", session, rules: pool, now: inside, requested: "late", canWaive: false })).toMatchObject({
      status: "cancelled",
      feeCents: null,
    });
    expect(decideCancel({ status: "late_cancelled", session, rules: pool, now: inside, canWaive: true })).toMatchObject({ ok: false });
  });
});

describe("staff booking after class", () => {
  it("staff can add someone up to a day after with a reason; members can't", () => {
    expect(bookingWindow(session, gx, at("2026-11-20T15:00:00Z"), "staff")).toMatchObject({ open: false, overridable: true });
    expect(bookingWindow(session, gx, at("2026-11-21T13:00:00Z"), "staff")).toMatchObject({ open: false, overridable: false });
    expect(bookingWindow(session, gx, at("2026-11-20T15:00:00Z"), "member")).toMatchObject({ open: false, overridable: false });
    expect(bookingWindow({ ...session, active: false }, gx, at("2026-11-20T15:00:00Z"), "staff")).not.toHaveProperty("overridable");
  });
});
