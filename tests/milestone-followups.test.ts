import { describe, expect, it } from "vitest";
import { milestoneOn } from "@/lib/email/milestone-content";
import { postClassFollowUpEmail } from "@/lib/email/templates";

describe("milestone follow-ups", () => {
  it("a milestone is on until it's saved off or a Club Admin turns it off", () => {
    expect(milestoneOn(undefined)).toBe(true);
    expect(milestoneOn({ enabled: true, disabled_by_admin: false })).toBe(true);
    expect(milestoneOn({ enabled: false, disabled_by_admin: false })).toBe(false);
    expect(milestoneOn({ enabled: true, disabled_by_admin: true })).toBe(false);
  });

  it("the after-class reminder names who reached a milestone", () => {
    const base = {
      className: "Beat",
      startDatetime: "2026-11-20T12:00:00Z",
      timezone: "America/Chicago",
      siteUrl: "https://synqiq.co",
      checkedInCount: 9,
    };
    const one = postClassFollowUpEmail({ ...base, milestones: [{ firstName: "Sam", count: "10th" }] });
    expect(one.html).toContain("Sam reached their 10th class.");
    const three = postClassFollowUpEmail({
      ...base,
      milestones: [
        { firstName: "Sam", count: "10th" },
        { firstName: "Ana", count: "3rd" },
        { firstName: "Lee", count: "1st" },
      ],
    });
    expect(three.html).toContain("Sam reached their 10th class, Ana their 3rd and Lee their 1st.");
  });
});
