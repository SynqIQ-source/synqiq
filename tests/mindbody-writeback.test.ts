import { describe, expect, it } from "vitest";
import { capacityTaken, desiredMindbodyState, pushStep, writebackActive } from "@/lib/booking/mindbody-state";
import { alreadyDone } from "@/lib/booking/mindbody-push";

describe("copying SynqIQ bookings into Mindbody", () => {
  it("knows what Mindbody should have", () => {
    expect(["booked", "checked_in", "no_show", "waitlisted", "cancelled", "late_cancelled"].map(desiredMindbodyState)).toEqual([
      "in",
      "in",
      "in",
      "waitlist",
      "out",
      "out",
    ]);
  });

  it("picks the Mindbody call", () => {
    expect(pushStep(null, "booked")).toEqual({ action: "add", waitlist: false });
    expect(pushStep(null, "waitlisted")).toEqual({ action: "add", waitlist: true });
    expect(pushStep("waitlist", "booked")).toEqual({ action: "add", waitlist: false });
    expect(pushStep("in", "late_cancelled")).toEqual({ action: "remove", lateCancel: true });
    expect(pushStep("in", "cancelled")).toEqual({ action: "remove", lateCancel: false });
    expect(pushStep("in", "checked_in")).toEqual({ action: "none" });
    expect(pushStep(null, "cancelled")).toEqual({ action: "none" });
  });

  it("runs only while switched on and before the cut-off", () => {
    expect(writebackActive(true, "2027-01-21", "2027-01-21")).toBe(true);
    expect(writebackActive(true, "2027-01-21", "2027-01-22")).toBe(false);
    expect(writebackActive(false, "2027-01-21", "2026-12-10")).toBe(false);
  });

  it("doesn't count a pushed booking twice", () => {
    expect(capacityTaken(10, 2, 3)).toBe(11);
    expect(capacityTaken(null, 0, 3)).toBe(3);
    expect(capacityTaken(1, 2, 3)).toBe(3);
  });

  it("treats 'already that way' answers from Mindbody as done", () => {
    expect(alreadyDone("remove", "Mindbody request failed: 400 Bad Request -- No class visit found for clientId: 1 and classId: 2")).toBe(
      true,
    );
    expect(alreadyDone("add", "The client is already booked into this class.")).toBe(true);
    expect(alreadyDone("add", "Class is full.")).toBe(false);
  });
});
