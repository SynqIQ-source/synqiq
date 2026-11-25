import { describe, expect, it } from "vitest";
import { cardLabel, cardLinkEmail, declinedPaymentEmail } from "@/lib/billing/notify";
import { hashToken, needsApproval } from "@/lib/billing/card-links";

describe("card update emails", () => {
  it("links the member to a secure card form when a payment is declined", () => {
    const email = declinedPaymentEmail({
      studioName: "The Preserve",
      firstName: "Sam",
      membership: "Gold",
      amountCents: 21900,
      card: "Visa ending 4242",
      retryOn: "2026-12-04",
      updateUrl: "https://synqiq.co/card/abc123",
    });
    expect(email.html).toContain('href="https://synqiq.co/card/abc123"');
    expect(email.html).toContain("Update your card");
  });

  it("asks the member to approve (not replace the card) when the bank wants 3D Secure", () => {
    const email = declinedPaymentEmail({
      studioName: "The Preserve",
      firstName: "Sam",
      membership: "Gold",
      amountCents: 21900,
      card: "Visa ending 3184",
      retryOn: "2026-12-04",
      approveUrl: "https://synqiq.co/pay/abc123",
    });
    expect(email.subject).toContain("approve");
    expect(email.html).toContain('href="https://synqiq.co/pay/abc123"');
    expect(email.html).toContain("Approve my payment");
    expect(email.html).not.toContain("Update your card");
    expect(needsApproval("authentication_required")).toBe(true);
    expect(needsApproval("insufficient_funds")).toBe(false);
    expect(needsApproval(null)).toBe(false);
  });

  it("warns about an expiring card, then reminds", () => {
    const first = cardLinkEmail({
      studioName: "The Preserve",
      firstName: "Sam",
      reason: "expiring",
      card: cardLabel("visa", "4242"),
      expires: "December 2026",
      updateUrl: "https://synqiq.co/card/abc",
    });
    expect(first.subject).toBe("Your card on file with The Preserve expires soon");
    expect(first.html).toContain("Visa ending 4242");
    expect(first.html).toContain("December 2026");
    const second = cardLinkEmail({
      ...{ studioName: "The Preserve", firstName: "", reason: "expiring" as const },
      card: null,
      expires: null,
      second: true,
      updateUrl: "u",
    });
    expect(second.subject).toBe("Reminder: your card on file with The Preserve expires soon");
    expect(cardLinkEmail({ studioName: "X", firstName: "", reason: "staff", card: null, expires: null, updateUrl: "u" }).subject).toBe(
      "Update your card on file with X",
    );
  });

  it("stores only a hash of the link token", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(cardLabel(null, null)).toBeNull();
  });
});
