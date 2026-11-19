import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATES,
  TEMPLATE_KEYS,
  defaultKit,
  renderStudioEmail,
  sampleVars,
  unknownPlaceholders,
  type EmailKit,
} from "@/lib/email/studio-templates";
import { cardLinkEmail, declinedPaymentEmail } from "@/lib/billing/notify";
import { ratingEmail } from "@/lib/ratings/job";

const kit = (patch: Partial<EmailKit["branding"]> = {}, overrides: EmailKit["overrides"] = {}): EmailKit => ({
  branding: { ...defaultKit("The Preserve").branding, ...patch },
  overrides,
});

describe("studio email templates", () => {
  it("defaults only use their own fields", () => {
    for (const key of TEMPLATE_KEYS) {
      expect(unknownPlaceholders(`${EMAIL_TEMPLATES[key].subject}\n${EMAIL_TEMPLATES[key].body}`, key)).toEqual([]);
    }
  });

  it("uses the studio's wording, escapes fields and places the button", () => {
    const email = renderStudioEmail(
      "card_link",
      { first_name: "<Sam>" },
      kit({}, { card_link: { subject: "Card time, {{first_name}}", body: "Hey {{first_name}}!\n\n[button]\n\nSee you **soon**." } }),
      { action: "<p>BUTTON</p>" },
    );
    expect(email.subject).toBe("Card time, <Sam>");
    expect(email.html).toContain("Hey &lt;Sam&gt;!");
    expect(email.html).toContain("<strong>soon</strong>");
    expect(email.html.indexOf("BUTTON")).toBeLessThan(email.html.indexOf("See you"));
  });

  it("adds the button at the end when the wording has no [button]", () => {
    const email = renderStudioEmail("card_link", {}, kit({}, { card_link: { subject: "x", body: "Just text" } }), {
      action: "<p>BUTTON</p>",
    });
    expect(email.html.indexOf("BUTTON")).toBeGreaterThan(email.html.indexOf("Just text"));
  });

  it("flags fields an email doesn't have", () => {
    expect(unknownPlaceholders("Hi {{first_name}} {{amount}}", "card_link")).toEqual(["amount"]);
  });

  it("wraps in the studio header, signature and footer", () => {
    const email = renderStudioEmail(
      "card_link",
      sampleVars("card_link"),
      kit({ logoUrl: "https://cdn.example.com/logo.png", color: "#123456", footer: "1 Main St", signature: "Cheers,\nTeam {{studio}}" }),
    );
    expect(email.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(email.html).toContain("background:#123456");
    expect(email.html).toContain("Cheers,<br>Team The Preserve");
    expect(email.html).toContain("1 Main St");
    const noLogo = renderStudioEmail(
      "card_link",
      {},
      kit({ logoUrl: "https://cdn.example.com/logo.png", showLogo: false, color: "red;x" }),
    );
    expect(noLogo.html).not.toContain("<img");
    expect(noLogo.html).toContain("background:#0f766e");
  });

  it("instructor reminders have no studio sign-off", () => {
    const email = renderStudioEmail("class_followup_reminder", sampleVars("class_followup_reminder"), kit());
    expect(email.html).not.toContain("Thank you,");
  });

  it("senders pass the studio kit through", () => {
    const custom = kit({}, { payment_declined: { subject: "Oops {{studio}}", body: "Retry {{retry_date}}" } });
    const declined = declinedPaymentEmail(
      { studioName: "The Preserve", firstName: "Sam", membership: "Gold", amountCents: 100, card: null, retryOn: "2026-12-04" },
      custom,
    );
    expect(declined.subject).toBe("Oops The Preserve");
    expect(declined.html).toContain("Retry Friday, December 4");
    expect(
      cardLinkEmail({ studioName: "The Preserve", firstName: "", reason: "expiring", card: null, expires: null, updateUrl: "u" }).html,
    ).toContain("this month");
    const rating = ratingEmail({
      studioName: "The Preserve",
      firstName: "Sam",
      className: "Flow",
      instructor: "Jess",
      when: "Tuesday",
      link: "https://x/r/t",
    });
    expect(rating.subject).toBe("How was Flow with Jess?");
    expect(rating.html).toContain("stars=5");
    expect(rating.html).toContain("Stop rating emails");
  });
});
