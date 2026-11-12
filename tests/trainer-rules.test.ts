import { describe, expect, it } from "vitest";
import { checkBooking, closeSession, conflictsWith, withinAvailability } from "@/lib/trainer/rules";

const T = (hhmm: string) => `2026-11-17T${hhmm}:00.000Z`;
const blocks = [
  { startsAt: T("11:00"), endsAt: T("13:00"), sessionTypeIds: null },
  { startsAt: T("13:00"), endsAt: T("15:00"), sessionTypeIds: [10] },
];
const now = new Date(T("08:00"));
const sales = { id: "sally", role: "sales", isTrainer: false };
const trainer = { id: "tom", role: "staff", isTrainer: true };
const otherTrainer = { id: "olga", role: "staff", isTrainer: true };

describe("withinAvailability", () => {
  it("joins touching blocks", () => {
    expect(withinAvailability({ startsAt: T("12:30"), endsAt: T("13:20") }, 10, blocks)).toBe(true);
  });
  it("respects session types on a block", () => {
    expect(withinAvailability({ startsAt: T("12:30"), endsAt: T("13:20") }, 25, blocks)).toBe(false);
  });
  it("rejects time outside the hours", () => {
    expect(withinAvailability({ startsAt: T("10:30"), endsAt: T("11:20") }, 10, blocks)).toBe(false);
  });
});

describe("conflictsWith", () => {
  const busy = [{ id: "a", startsAt: T("11:00"), endsAt: T("11:50"), sessionTypeId: 26 }];
  it("finds overlaps", () => {
    expect(conflictsWith({ startsAt: T("11:30"), endsAt: T("12:20"), sessionTypeId: 10 }, busy)).toHaveLength(1);
    expect(conflictsWith({ startsAt: T("11:50"), endsAt: T("12:40"), sessionTypeId: 10 }, busy)).toHaveLength(0);
  });
  it("lets semi-private share a slot", () => {
    expect(conflictsWith({ startsAt: T("11:00"), endsAt: T("11:50"), sessionTypeId: 26 }, busy)).toHaveLength(0);
  });
});

describe("checkBooking", () => {
  const base = { trainerId: "tom", blocks, busy: [], now, reason: "", covered: true };
  const slot = { startsAt: T("11:00"), endsAt: T("11:50"), sessionTypeId: 10 };
  it("anyone can book inside the hours", () => {
    for (const who of [sales, otherTrainer, trainer]) expect(checkBooking({ ...base, who, slot }).ok).toBe(true);
  });
  it("outside the hours: only the trainer or a Club Admin, with a reason", () => {
    const late = { startsAt: T("16:00"), endsAt: T("16:50"), sessionTypeId: 10 };
    expect(checkBooking({ ...base, who: sales, slot: late })).toMatchObject({ ok: false });
    expect(checkBooking({ ...base, who: trainer, slot: late })).toMatchObject({ ok: false, needsReason: true });
    expect(checkBooking({ ...base, who: trainer, slot: late, reason: "Early client" })).toMatchObject({ ok: true });
    expect(checkBooking({ ...base, who: { id: "boss", role: "admin", isTrainer: false }, slot: late, reason: "x" }).ok).toBe(true);
  });
  it("double-booking needs the trainer or a Club Admin", () => {
    const busy = [{ id: "a", startsAt: T("11:00"), endsAt: T("11:50"), sessionTypeId: 10 }];
    expect(checkBooking({ ...base, busy, who: sales, slot })).toMatchObject({ ok: false });
    expect(checkBooking({ ...base, busy, who: trainer, slot, reason: "ok" })).toMatchObject({ ok: true, warnings: ["Double-booked"] });
  });
  it("no pack needs a reason", () => {
    expect(checkBooking({ ...base, who: sales, slot, covered: false })).toMatchObject({ ok: false, needsReason: true });
    expect(checkBooking({ ...base, who: sales, slot, covered: false, reason: "Paying today" }).ok).toBe(true);
  });
});

describe("closeSession", () => {
  it("completing, no-shows and late cancels pay; an on-time cancel doesn't", () => {
    const after = new Date(T("12:00"));
    expect(closeSession({ status: "booked", action: "complete", startsAt: T("11:00"), now: after })).toMatchObject({
      status: "completed",
      pays: true,
    });
    expect(closeSession({ status: "booked", action: "no_show", startsAt: T("11:00"), now: after })).toMatchObject({
      pays: true,
      noShow: true,
    });
    expect(closeSession({ status: "booked", action: "late_cancel", startsAt: T("11:00"), now })).toMatchObject({ pays: true });
    expect(closeSession({ status: "booked", action: "cancel", startsAt: T("11:00"), now })).toMatchObject({ pays: false });
  });
  it("can't complete before it starts or twice", () => {
    expect(closeSession({ status: "booked", action: "complete", startsAt: T("11:00"), now }).ok).toBe(false);
    expect(closeSession({ status: "completed", action: "cancel", startsAt: T("11:00"), now }).ok).toBe(false);
  });
});
