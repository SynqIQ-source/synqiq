import { describe, expect, it } from "vitest";
import {
  MILESTONES,
  SUGGESTED,
  fillMilestone,
  milestoneFor,
  ordinal,
  renderMilestoneEmail,
  unknownMilestoneFields,
} from "@/lib/email/milestone-content";
import { defaultKit } from "@/lib/email/studio-templates";

describe("class milestone emails", () => {
  it("knows the milestones, then every 100", () => {
    expect([1, 3, 10, 25, 50, 100].map(milestoneFor)).toEqual([1, 3, 10, 25, 50, 100]);
    expect(milestoneFor(200)).toBe(200);
    expect(milestoneFor(700)).toBe(200);
    expect(milestoneFor(2)).toBeNull();
    expect(milestoneFor(150)).toBeNull();
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 101, 111, 300].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "101st",
      "111th",
      "300th",
    ]);
  });

  it("suggested wording only uses known fields", () => {
    for (const milestone of MILESTONES) {
      expect(unknownMilestoneFields(`${SUGGESTED[milestone].subject}\n${SUGGESTED[milestone].body}`)).toEqual([]);
    }
    expect(unknownMilestoneFields("{{first_name}} {{amount}}")).toEqual(["amount"]);
  });

  it("fills and renders without a studio sign-off, escaping the text", () => {
    const body = fillMilestone(SUGGESTED[200].body, {
      first_name: "<Sam>",
      count: "300th",
      studio: "The Preserve",
      instructor: "Jess",
      class_name: "Flow",
    });
    const email = renderMilestoneEmail(
      defaultKit("The Preserve"),
      fillMilestone(SUGGESTED[200].subject, { count: "300th", first_name: "Sam" }),
      body,
    );
    expect(email.subject).toBe("300th class, Sam!");
    expect(email.html).toContain("&lt;Sam&gt;");
    expect(email.html).toContain("300th class");
    expect(email.html).not.toContain("Thank you,<br>");
  });
});
