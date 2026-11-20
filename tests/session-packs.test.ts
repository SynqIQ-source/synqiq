import { describe, expect, it } from "vitest";
import {
  choosePack,
  isCountedPack,
  packKind,
  refreshesFromMindbody,
  sessionsUsed,
  packUseKind,
  type PackForBooking,
} from "@/lib/sessions/packs-rules";

const pack = (patch: Partial<PackForBooking>): PackForBooking => ({
  id: "p",
  name: "PT 60 16PK",
  kind: "pt",
  remaining: 5,
  reserved: 0,
  expiresOn: "2027-06-01",
  ...patch,
});

describe("prepaid session packs", () => {
  it("knows what kind of pack it is, and skips unlimited access", () => {
    expect(packKind("PT 60 16PK", "Personal Training")).toBe("pt");
    expect(packKind("Intro Workout", "Personal Training")).toBe("intro");
    expect(packKind("PT Semi Private 12PK", null)).toBe("pt");
    expect(packKind("5 Pack Group Reformer", "Group Reformer")).toBe("class");
    expect(isCountedPack(16)).toBe(true);
    expect(isCountedPack(99999)).toBe(false);
    expect(isCountedPack(0)).toBe(false);
  });

  it("books against the soonest-expiring PT pack with a session free", () => {
    const packs = [
      pack({ id: "late", expiresOn: "2027-09-01" }),
      pack({ id: "soon", expiresOn: "2027-01-15" }),
      pack({ id: "full", expiresOn: "2026-12-30", remaining: 2, reserved: 2 }),
      pack({ id: "expired", expiresOn: "2026-11-01" }),
      pack({ id: "intro", kind: "intro", expiresOn: "2026-12-01" }),
    ];
    expect(choosePack(packs, "2026-12-01")?.id).toBe("soon");
    expect(choosePack(packs, "2027-08-01")?.id).toBe("late");
    expect(choosePack([pack({ id: "intro", kind: "intro" })], "2026-12-01")?.id).toBe("intro");
    expect(choosePack([pack({ remaining: 0 })], "2026-12-01")).toBeNull();
  });

  it("uses a session for completed, no-show and late cancel only", () => {
    expect(["completed", "no_show", "late_cancelled", "cancelled", "booked"].map(sessionsUsed)).toEqual([1, 1, 1, 0, 0]);
    expect(packUseKind("late_cancelled")).toBe("late_cancel");
    expect(packUseKind("cancelled")).toBeNull();
  });

  it("follows Mindbody until the switch date", () => {
    expect(refreshesFromMindbody("2026-12-17", "2026-12-18")).toBe(true);
    expect(refreshesFromMindbody("2026-12-18", "2026-12-18")).toBe(false);
  });
});
