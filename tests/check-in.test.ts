import { describe, expect, it } from "vitest";
import { decideCheckIn, type ServiceInfo } from "@/lib/checkin/eligibility";

const TODAY = "2026-11-11";
const membershipService: ServiceInfo = {
  id: 1,
  name: "12 Month Commitment",
  program: "Memberships & Passes",
  count: 999999,
  remaining: 999998,
  activeDate: "2026-11-02",
  expirationDate: "2026-12-02",
  current: true,
};
const base = {
  today: TODAY,
  services: [membershipService],
  arrivalPrograms: ["Memberships & Passes", "Fee's"],
  contracts: [{ id: "c1", name: "12 Month Commitment", startDate: "2026-07-02", endDate: "2027-06-02", autopayStatus: "Active" }],
  synqiqEdits: [],
  clientStatus: "Active",
  alreadyCheckedInToday: false,
};

describe("check-in eligibility", () => {
  it("a membership's arrival service covers the visit", () => {
    expect(decideCheckIn(base)).toMatchObject({
      covered: true,
      kind: "membership",
      coverageName: "12 Month Commitment",
      contractId: "c1",
      remaining: null,
      warnings: [],
    });
  });

  it("a guest pass covers it as a pass and warns when visits run low", () => {
    const pass = { ...membershipService, id: 2, name: "7 Day Guest Pass", count: 7, remaining: 1, expirationDate: "2026-11-20" };
    const decision = decideCheckIn({ ...base, services: [pass], contracts: [] });
    expect(decision).toMatchObject({ covered: true, kind: "pass", coverageName: "7 Day Guest Pass", remaining: 1 });
    expect(decision.warnings).toContain("1 visit left on 7 Day Guest Pass.");
  });

  it("PT packs, used-up and expired passes don't cover a gym visit", () => {
    const services: ServiceInfo[] = [
      { ...membershipService, id: 3, name: "PT 60", program: "Personal Training", count: 16, remaining: 13 },
      { ...membershipService, id: 4, name: "Day Pass", count: 1, remaining: 0 },
      { ...membershipService, id: 5, name: "Old pass", expirationDate: "2026-11-01" },
    ];
    expect(decideCheckIn({ ...base, services, contracts: [] })).toMatchObject({ covered: false, kind: "none" });
  });

  it("warns about frozen, declined, SynqIQ cancellations and a second visit today", () => {
    const decision = decideCheckIn({
      ...base,
      contracts: [{ ...base.contracts[0], autopayStatus: "Suspended" }],
      synqiqEdits: [{ kind: "cancel", startsOn: "2026-11-01", endsOn: null }],
      clientStatus: "Declined",
      alreadyCheckedInToday: true,
    });
    expect(decision.warnings).toEqual([
      "12 Month Commitment is frozen in Mindbody.",
      "Cancelled in SynqIQ (planned for after the switch).",
      "Their last payment was declined.",
      "Already checked in today.",
    ]);
  });
});
