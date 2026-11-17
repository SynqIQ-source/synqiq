import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildReceiptPdf } from "@/lib/pos/receipt-pdf";

const base = {
  studioName: "The Preserve",
  title: "Receipt",
  number: "Sale #1042",
  dateLocal: "Nov 17, 2026, 2:14 PM",
  memberName: "Pat Member",
  lines: [
    { name: "Protein bar", quantity: 2, amountCents: 700 },
    { name: "A very long product name ".repeat(8), quantity: 1, amountCents: 2500 },
  ],
  subtotalCents: 3200,
  discountCents: 200,
  taxCents: 248,
  totalCents: 3248,
  paymentLabel: "Card on file",
  practice: false,
};

describe("buildReceiptPdf", () => {
  it("makes a one-page PDF titled with the receipt number", async () => {
    const bytes = await buildReceiptPdf(base);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Receipt - Sale #1042");
  });

  it("copes with characters the PDF font can't draw", async () => {
    const bytes = await buildReceiptPdf({ ...base, memberName: "Zoë 李 🙂", practice: true });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
