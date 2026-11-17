import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// A one-page receipt PDF (US Letter) for a checkout sale or a monthly dues
// payment. Pure: callers load and check the data.

export type ReceiptLine = { name: string; quantity: number; amountCents: number };

export type ReceiptInput = {
  studioName: string;
  title: string; // "Receipt" / "Monthly dues receipt"
  number: string; // e.g. "Sale #1042"
  dateLocal: string; // e.g. "Nov 17, 2026, 2:14 PM"
  memberName: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentLabel: string; // e.g. "Card on file", "Practice -- no payment taken"
  practice: boolean;
};

const PAGE = { width: 612, height: 792, margin: 54 };

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Standard fonts are WinAnsi only; anything else becomes "?" so a stray
// character never breaks the PDF.
const clean = (text: string) => text.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•]/g, "?");

function fit(text: string, font: PDFFont, size: number, width: number) {
  let value = clean(text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > width) value = value.slice(0, -1);
  return `${value}...`;
}

export async function buildReceiptPdf(input: ReceiptInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.title} - ${input.number}`);
  pdf.setAuthor(input.studioName);
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.42, 0.42, 0.42);
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  let y = PAGE.height - PAGE.margin;

  const text = (value: string, x: number, size: number, font = regular, color = dark) =>
    page.drawText(clean(value), { x, y, size, font, color });
  const rightText = (value: string, size: number, font = regular, color = dark) =>
    page.drawText(clean(value), { x: right - font.widthOfTextAtSize(clean(value), size), y, size, font, color });
  const rule = () => page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: rgb(0.82, 0.82, 0.82) });

  text(input.studioName, left, 18, bold);
  rightText(input.title, 14, bold);
  y -= 22;
  text(input.number, left, 10, regular, muted);
  rightText(input.dateLocal, 10, regular, muted);
  y -= 26;
  text("Billed to", left, 9, bold, muted);
  y -= 14;
  text(input.memberName, left, 11);
  y -= 30;

  if (input.practice) {
    page.drawRectangle({ x: left, y: y - 6, width: right - left, height: 22, color: rgb(1, 0.95, 0.82) });
    text("PRACTICE RECEIPT - no payment was taken. Shown for testing before payments go live.", left + 8, 9, bold, rgb(0.55, 0.36, 0));
    y -= 34;
  }

  text("Item", left, 9, bold, muted);
  page.drawText("Qty", { x: right - 150, y, size: 9, font: bold, color: muted });
  rightText("Amount", 9, bold, muted);
  y -= 8;
  rule();
  y -= 16;
  for (const line of input.lines) {
    if (y < PAGE.margin + 140) break;
    text(fit(line.name, regular, 10.5, right - 170 - left), left, 10.5);
    page.drawText(String(line.quantity), { x: right - 150, y, size: 10.5, font: regular, color: dark });
    rightText(money(line.amountCents), 10.5);
    y -= 18;
  }
  y -= 4;
  rule();
  y -= 18;

  const total = (label: string, cents: number, strong = false) => {
    page.drawText(clean(label), {
      x: right - 220,
      y,
      size: strong ? 12 : 10.5,
      font: strong ? bold : regular,
      color: strong ? dark : muted,
    });
    rightText(money(cents), strong ? 12 : 10.5, strong ? bold : regular);
    y -= strong ? 22 : 16;
  };
  total("Subtotal", input.subtotalCents);
  if (input.discountCents) total("Discounts", -input.discountCents);
  total("Sales tax", input.taxCents);
  y -= 2;
  total("Total", input.totalCents, true);
  y -= 6;
  text(`Payment: ${input.paymentLabel}`, left, 10, regular, muted);
  y -= 40;
  text(`Thank you for being part of ${input.studioName}.`, left, 10, regular, muted);

  return pdf.save();
}
