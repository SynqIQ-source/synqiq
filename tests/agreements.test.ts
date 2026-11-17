import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fillAgreement, RATE_INCREASE_CLAUSE, templateFromMindbody } from "@/lib/agreements/render";
import { signatureProblem, type AgreementToSign } from "@/lib/agreements/sale";
import { buildAgreementPdf } from "@/lib/agreements/pdf";

const MINDBODY = [
  "Membership Privileges, Notices, Disclosures, & Agreements",
  "Membership Type: Summer Student Promotion",
  "Monthly Dues: $269.00, plus tax",
  "First Payment Due: $369.00, plus tax",
  "Ongoing Due Date: Same date as original enrollment",
  "Not Withstanding any other provisions of this Agreement, you understand that dues are based on current sales tax rates and should such rates increase the club may increase your dues.",
  "1. Cancellation requires 30 days' notice.",
].join("\n");

describe("templateFromMindbody", () => {
  it("swaps Mindbody's plan name and prices for placeholders and adds the rate clause after the sales-tax paragraph", () => {
    const template = templateFromMindbody(MINDBODY, { rateIncrease: true });
    expect(template).toContain("Membership Type: {{item}}");
    expect(template).toContain("Monthly Dues: {{monthly_dues}}, plus tax");
    expect(template).toContain("First Payment Due: {{first_payment}}, plus tax");
    expect(template).not.toContain("Summer Student");
    const lines = template.split("\n");
    const taxLine = lines.findIndex((line) => line.startsWith("Not Withstanding"));
    expect(lines[taxLine + 2]).toBe(RATE_INCREASE_CLAUSE);
    expect(template).toContain("1. Cancellation requires");
  });

  it("puts the clause after the header when there's no sales-tax paragraph, and leaves it out when asked", () => {
    const noTax = MINDBODY.split("\n")
      .filter((line) => !line.startsWith("Not Withstanding"))
      .join("\n");
    const lines = templateFromMindbody(noTax, { rateIncrease: true }).split("\n");
    expect(lines.indexOf(RATE_INCREASE_CLAUSE)).toBe(lines.findIndex((line) => line.startsWith("Ongoing")) + 2);
    expect(templateFromMindbody(MINDBODY, { rateIncrease: false })).not.toContain("Annual Rate Increase");
  });
});

describe("fillAgreement", () => {
  it("fills what's being sold and leaves unknown placeholders alone", () => {
    const filled = fillAgreement(templateFromMindbody(MINDBODY, { rateIncrease: true }) + "\n{{unknown}} {{sessions}}", {
      business_name: "The Preserve Gym LLC",
      item: "Associate Membership",
      monthly_dues: "$199.00",
      first_payment: "$299.00",
    });
    expect(filled).toContain("Membership Type: Associate Membership");
    expect(filled).toContain("Monthly Dues: $199.00, plus tax");
    expect(filled).toContain(
      "The Preserve Gym LLC may increase the monthly membership rate by one percent (1%) to five percent (5%) per year.",
    );
    expect(filled).toContain("{{unknown}} —");
  });
});

const agreement: AgreementToSign = {
  lineIndex: 0,
  itemId: "i",
  itemName: "Premium 12 PT (50)",
  templateId: "t",
  templateVersion: 1,
  title: "Premium 12 PT (50) Agreement",
  body: "Terms",
  sha256: "abc",
};
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("signatureProblem", () => {
  const ok = { lineIndex: 0, sha256: "abc", signerName: "Pat Member", method: "drawn" as const, signature: PNG, agreed: true };
  it("accepts a drawn signature or a typed agreement", () => {
    expect(signatureProblem([agreement], [ok])).toBeNull();
    expect(signatureProblem([agreement], [{ ...ok, method: "typed", signature: null }])).toBeNull();
    expect(signatureProblem([], [])).toBeNull();
  });
  it("refuses missing, changed, unagreed or unsigned agreements", () => {
    expect(signatureProblem([agreement], [])).toMatch(/needs to sign/);
    expect(signatureProblem([agreement], [{ ...ok, sha256: "other" }])).toMatch(/changed/);
    expect(signatureProblem([agreement], [{ ...ok, agreed: false }])).toMatch(/agree/);
    expect(signatureProblem([agreement], [{ ...ok, signerName: " " }])).toMatch(/full name/);
    expect(signatureProblem([agreement], [{ ...ok, signature: "data:image/png;base64,AAAA" }])).toMatch(/sign in the box/);
  });
});

describe("buildAgreementPdf", () => {
  it("makes a PDF with the agreement title", async () => {
    const bytes = await buildAgreementPdf({
      businessName: "The Preserve Gym LLC",
      title: "Adult Monthly Membership Agreement",
      body: "Line one\n\nLine two ".repeat(200),
      bodySha256: "abc",
      templateVersion: 2,
      memberName: "Zoë 李",
      signerName: "Zoë 李",
      method: "drawn",
      signaturePng: Uint8Array.from(Buffer.from(PNG.split(",")[1], "base64")),
      saleNumber: 12,
      signedAtLocal: "Nov 17, 2026, 5:00:00 PM CST",
      signedAtUtc: "2026-11-17T23:00:00.000Z",
      staffName: "Desk",
      ip: null,
      userAgent: null,
      signatureId: "id",
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toContain("Adult Monthly Membership Agreement");
  });
});
