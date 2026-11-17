import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { DEFAULT_CADENCE, cadenceDays, cadenceFrom, followUpFor, type FollowUpContact, type LeadActivity } from "@/lib/crm/follow-ups";

const TZ = "America/Chicago";
const at = (day: number, hour = 15) => DateTime.fromISO("2026-11-01T00:00", { zone: TZ }).plus({ days: day, hours: hour }).toUTC().toISO()!;
const now = (day: number) => DateTime.fromISO("2026-11-01T12:00", { zone: TZ }).plus({ days: day }) as DateTime<true>;

const contact = (extra: Partial<FollowUpContact> = {}): FollowUpContact => ({
  id: "c1",
  created_at: at(0, 9),
  status: "lead",
  closed_at: null,
  sms_opted_out_at: null,
  follow_up_on: null,
  follow_up_set_at: null,
  assigned_staff_id: null,
  ...extra,
});
const activity = (extra: Partial<LeadActivity> = {}): LeadActivity => ({
  firstVisitAt: null,
  lastVisitAt: null,
  contactTimes: [],
  calls: 0,
  texts: 0,
  emails: 0,
  nextAppointmentAt: null,
  lastMissedAppointmentAt: null,
  lastReplyAt: null,
  ...extra,
});
const contacts = (days: number[]) => days.map((day) => at(day));

describe("follow-up cadence (default: 7 attempts, day 0, 1, then every 3 days)", () => {
  it("lays out the attempt days", () => {
    expect(cadenceDays(DEFAULT_CADENCE)).toEqual([0, 1, 4, 7, 10, 13, 16]);
  });

  it("first attempt is due the day after they come in", () => {
    const result = followUpFor(contact(), activity(), TZ, now(0));
    expect(result).toMatchObject({ kind: "due", dueOn: "2026-11-02", attempt: 1, of: 7, daysOverdue: -1 });
  });

  it("second attempt a day after the first, then every 3 days", () => {
    expect(followUpFor(contact(), activity({ contactTimes: contacts([0]) }), TZ, now(0))).toMatchObject({
      dueOn: "2026-11-02",
      attempt: 2,
    });
    expect(followUpFor(contact(), activity({ contactTimes: contacts([0, 1]) }), TZ, now(1))).toMatchObject({
      dueOn: "2026-11-05",
      attempt: 3,
    });
    expect(followUpFor(contact(), activity({ contactTimes: contacts([0, 1, 4, 7, 10, 13]) }), TZ, now(13))).toMatchObject({
      dueOn: "2026-11-17",
      attempt: 7,
    });
  });

  it("visited or not, the cadence is the same", () => {
    const visited = activity({ firstVisitAt: at(0, 10), lastVisitAt: at(0, 10), contactTimes: contacts([0, 1]) });
    expect(followUpFor(contact(), visited, TZ, now(1))).toMatchObject({ kind: "due", dueOn: "2026-11-05", queue: "visited" });
  });

  it("after the 7th attempt: waiting, then the warm pool 2 days later", () => {
    const seven = activity({ contactTimes: contacts([0, 1, 4, 7, 10, 13, 16]) });
    expect(followUpFor(contact(), seven, TZ, now(17))).toMatchObject({ kind: "waiting", poolOn: "2026-11-19", attempts: 7 });
    expect(followUpFor(contact(), seven, TZ, now(18))).toMatchObject({ kind: "pool", since: "2026-11-19", attempts: 7 });
  });

  it("a reply starts the attempts over", () => {
    const replied = activity({ contactTimes: contacts([0, 1, 4, 7, 10, 13, 16]), lastReplyAt: at(17) });
    expect(followUpFor(contact(), replied, TZ, now(18))).toMatchObject({ kind: "due", dueOn: "2026-11-19", attempt: 1 });
  });

  it("a visit starts the attempts over", () => {
    const visited = activity({ contactTimes: contacts([0, 1, 4]), firstVisitAt: at(5), lastVisitAt: at(5) });
    expect(followUpFor(contact(), visited, TZ, now(5))).toMatchObject({ kind: "due", dueOn: "2026-11-07", attempt: 1 });
  });

  it("a follow-up date a salesperson sets wins, even in the pool", () => {
    const seven = activity({ contactTimes: contacts([0, 1, 4, 7, 10, 13, 16]) });
    const set = contact({ follow_up_on: "2026-12-01", follow_up_set_at: at(20) });
    expect(followUpFor(set, seven, TZ, now(21))).toMatchObject({ kind: "due", dueOn: "2026-12-01", rescheduled: true });
  });

  it("uses the studio's own cadence", () => {
    const cadence = cadenceFrom({ attempts: 3, dailyAttempts: 1, everyDays: 5, poolAfterDays: 0 });
    expect(cadenceDays(cadence)).toEqual([0, 5, 10]);
    expect(followUpFor(contact(), activity({ contactTimes: contacts([0, 5, 10]) }), TZ, now(10), cadence)).toMatchObject({ kind: "pool" });
  });

  it("falls back to the default for missing or bad settings", () => {
    expect(cadenceFrom(null)).toEqual(DEFAULT_CADENCE);
    expect(cadenceFrom({ attempts: 0, everyDays: "x", poolAfterDays: 4 })).toEqual({ ...DEFAULT_CADENCE, poolAfterDays: 4 });
  });
});

describe("warm pool flag and imported history", () => {
  it("a lead put in the pool stays there until something new happens", () => {
    const pooled = contact({ import_batch_id: "b1", warm_pool_at: at(30) });
    const old = activity({ contactTimes: contacts([2, 5]) });
    expect(followUpFor(pooled, old, TZ, now(40))).toMatchObject({ kind: "pool", since: "2026-12-01" });
    const replied = activity({ contactTimes: contacts([2, 5]), lastReplyAt: at(35) });
    expect(followUpFor(pooled, replied, TZ, now(36))).toMatchObject({ kind: "due", attempt: 1 });
  });

  it("an imported lead with no history in the pool is in the pool, not 'not worked yet'", () => {
    expect(followUpFor(contact({ import_batch_id: "b1", warm_pool_at: at(1) }), activity(), TZ, now(2))).toMatchObject({ kind: "pool" });
    expect(followUpFor(contact({ import_batch_id: "b1" }), activity(), TZ, now(40))).toMatchObject({ kind: "stopped", reason: "imported" });
    // A new imported lead (came in within 30 days) goes on the follow-up lists.
    expect(followUpFor(contact({ import_batch_id: "b1" }), activity(), TZ, now(2))).toMatchObject({ kind: "due", attempt: 1 });
  });
});
