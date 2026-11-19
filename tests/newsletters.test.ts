import { describe, expect, it } from "vitest";
import { cleanFilters, describeFilters, newsletterContent, renderNewsletter } from "@/lib/email/newsletter-content";
import { defaultKit } from "@/lib/email/studio-templates";

describe("newsletters", () => {
  it("keeps only known filters", () => {
    expect(
      cleanFilters({
        types: ["member", "hacker", "member"],
        member_status: ["frozen"],
        sources: ["web", "x"],
        created_from: "2026-01-01",
        created_to: "not a date",
        not_visited_days: "30",
        extra: 1,
      }),
    ).toEqual({ types: ["member"], member_status: ["frozen"], sources: ["web"], created_from: "2026-01-01", not_visited_days: 30 });
    expect(cleanFilters({ not_visited_days: -5 })).toEqual({});
    expect(cleanFilters(null)).toEqual({});
  });

  it("describes the audience", () => {
    expect(describeFilters({})).toBe("members, leads, guests");
    expect(describeFilters({ types: ["member"], member_status: ["active"], not_visited_days: 60 })).toBe(
      "members · members active · no visit in 60 days",
    );
  });

  it("formats headings, bold, links and pictures, and escapes the rest", () => {
    const html = newsletterContent(
      "## Big {{first_name}} news\n\nCome **today** <b>now</b>. [Book](https://synqiq.co/m/1?a=1&b=2)\n\n![Pool](https://cdn.x/p.jpg)\n\n[bad](javascript:alert(1))",
      { first_name: "Sam" },
      "#123456",
    );
    expect(html).toContain("<h2");
    expect(html).toContain("Big Sam news");
    expect(html).toContain("<strong>today</strong>");
    expect(html).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(html).toContain('href="https://synqiq.co/m/1?a=1&amp;b=2"');
    expect(html).toContain('<img src="https://cdn.x/p.jpg"');
    expect(html).not.toContain('href="javascript');
  });

  it("always has an unsubscribe link", () => {
    const email = renderNewsletter(defaultKit("The Preserve"), "Hi {{first_name}}", "Hello", {
      firstName: null,
      unsubscribeUrl: "https://synqiq.co/u/abc",
    });
    expect(email.subject).toBe("Hi there");
    expect(email.html).toContain('href="https://synqiq.co/u/abc"');
    expect(email.html).toContain("Unsubscribe");
  });
});
