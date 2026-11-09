import { describe, expect, it } from "vitest";
import { applyIntroDecline, classifyEnrollment, type Intro } from "@/lib/crm/onboarding";
import type { MindbodyClientContract } from "@/types/mindbody";

const TZ = "America/Chicago";
const isMembership = (name: string | null | undefined) => Boolean(name && /membership|commitment/i.test(name));
const contract = (fields: Partial<MindbodyClientContract>) => fields as MindbodyClientContract;

describe("applyIntroDecline", () => {
  const declinedAt = "2026-11-10T15:00:00.000Z";
  const intro = (status: Intro["status"]): Intro => ({ status, at: "2026-11-12T15:00:00.000Z", trainerStaffId: "t" });

  it("shows declined when nothing is booked", () => {
    expect(applyIntroDecline(undefined, declinedAt)).toEqual({ status: "declined", at: declinedAt, trainerStaffId: null });
    expect(applyIntroDecline(intro("no_show"), declinedAt).status).toBe("declined");
    expect(applyIntroDecline(intro("late_cancel"), declinedAt).status).toBe("declined");
  });

  it("a real booked or completed intro still wins", () => {
    expect(applyIntroDecline(intro("booked"), declinedAt).status).toBe("booked");
    expect(applyIntroDecline(intro("done"), declinedAt).status).toBe("done");
  });

  it("does nothing when the member never declined", () => {
    expect(applyIntroDecline(undefined, null).status).toBe("none");
    expect(applyIntroDecline(intro("booked"), null).status).toBe("booked");
  });
});

describe("classifyEnrollment (is this a new membership sale?)", () => {
  const detected = "2026-12-02T12:00:00.000Z";

  it("counts a first membership as new", () => {
    const decision = classifyEnrollment(
      [contract({ ContractName: "Adult Monthly Membership", StartDate: "2026-12-01T00:00:00" })],
      isMembership,
      detected,
      TZ,
    );
    expect(decision).toMatchObject({ counts: true, kind: "new" });
  });

  it("ignores packs that aren't memberships", () => {
    const decision = classifyEnrollment(
      [contract({ ContractName: "8 PT (50)", StartDate: "2026-12-01T00:00:00" })],
      isMembership,
      detected,
      TZ,
    );
    expect(decision).toMatchObject({ counts: false, note: "not_membership" });
  });

  it("does not count an automatic renewal", () => {
    const decision = classifyEnrollment(
      [contract({ ContractName: "12 Month Commitment", StartDate: "2026-12-01T00:00:00", AutoRenewClientContractID: 123 })],
      isMembership,
      detected,
      TZ,
    );
    expect(decision).toMatchObject({ counts: false, note: "renewal" });
  });

  it("treats a new membership soon after the last one ended as a continuation", () => {
    const decision = classifyEnrollment(
      [
        contract({ ContractName: "Adult Monthly Membership", StartDate: "2025-12-01T00:00:00", EndDate: "2026-11-15T00:00:00" }),
        contract({ ContractName: "Adult Monthly Membership", StartDate: "2026-12-01T00:00:00" }),
      ],
      isMembership,
      detected,
      TZ,
    );
    expect(decision).toMatchObject({ counts: false, note: "continuation" });
  });

  it("counts someone coming back after more than 90 days as returning", () => {
    const decision = classifyEnrollment(
      [
        contract({ ContractName: "Adult Monthly Membership", StartDate: "2025-01-01T00:00:00", EndDate: "2025-06-01T00:00:00" }),
        contract({ ContractName: "Adult Monthly Membership", StartDate: "2026-12-01T00:00:00" }),
      ],
      isMembership,
      detected,
      TZ,
    );
    expect(decision).toMatchObject({ counts: true, kind: "returning" });
  });
});
