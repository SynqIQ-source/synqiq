import { describe, expect, it } from "vitest";
import { keepEmail } from "@/lib/sync/client-email";

describe("which Mindbody emails are kept", () => {
  const checked = new Set([1]);
  it("keeps checked-in members and opted-in current/former members only", () => {
    expect(keepEmail({ UniqueId: 1, Status: "Non-Member", SendPromotionalEmails: false }, checked)).toBe(true);
    expect(keepEmail({ UniqueId: 2, Status: "Active", SendPromotionalEmails: true }, checked)).toBe(true);
    expect(keepEmail({ UniqueId: 3, Status: "Terminated", SendPromotionalEmails: true }, checked)).toBe(true);
    expect(keepEmail({ UniqueId: 4, Status: "Active", SendPromotionalEmails: false }, checked)).toBe(false);
    expect(keepEmail({ UniqueId: 5, Status: "Non-Member", SendPromotionalEmails: true }, checked)).toBe(false);
    expect(keepEmail({ UniqueId: 6, Status: "Expired" }, checked)).toBe(false);
  });
});
