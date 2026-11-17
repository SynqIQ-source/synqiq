import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { toWinAnsi, wrap } from "@/lib/crm/waiver-pdf";

// The signed agreement as a PDF (US Letter): the exact text agreed to, who
// signed and how (drawn signature, or typed name and agreement), and the
// signing evidence. Pure: callers check and store.

export type AgreementPdfInput = {
  businessName: string;
  title: string;
  body: string;
  bodySha256: string;
  templateVersion: number;
  memberName: string;
  signerName: string;
  method: "drawn" | "typed";
  signaturePng: Uint8Array | null;
  saleNumber: number | null;
  signedAtLocal: string;
  signedAtUtc: string;
  staffName: string | null;
  ip: string | null;
  userAgent: string | null;
  signatureId: string;
};

const PAGE = { width: 612, height: 792, margin: 54 };
const BODY_SIZE = 9.5;
const LINE = 13;

export async function buildAgreementPdf(input: AgreementPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(toWinAnsi(`${input.title} - ${input.memberName}`));
  pdf.setAuthor(toWinAnsi(input.businessName));
  pdf.setProducer("SynqIQ");
  pdf.setCreationDate(new Date(input.signedAtUtc));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const textWidth = PAGE.width - PAGE.margin * 2;
  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < PAGE.margin) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
  };
  const write = (text: string, options: { font?: PDFFont; size?: number; muted?: boolean } = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? BODY_SIZE;
    for (const line of wrap(toWinAnsi(text), font, size, textWidth)) {
      ensureSpace(LINE);
      if (line) page.drawText(line, { x: PAGE.margin, y, size, font, color: options.muted ? rgb(0.35, 0.35, 0.4) : rgb(0.1, 0.1, 0.12) });
      y -= size > BODY_SIZE ? size + 5 : LINE;
    }
  };

  write(input.businessName, { font: bold, size: 14 });
  write(input.title, { font: bold, size: 12 });
  write(`Member: ${input.memberName}${input.saleNumber ? ` · Sale #${input.saleNumber}` : ""}`, { size: 10, muted: true });
  y -= 8;
  write(input.body);
  y -= 14;

  ensureSpace(150);
  write("AGREED AND SIGNED", { font: bold, size: 11 });
  write(`Name: ${input.signerName}`);
  if (input.method === "drawn" && input.signaturePng) {
    const image = await pdf.embedPng(input.signaturePng);
    const scale = Math.min(220 / image.width, 80 / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    ensureSpace(height + 30);
    y -= 6;
    write("Signature", { font: bold });
    page.drawImage(image, { x: PAGE.margin, y: y - height + 8, width, height });
    y -= height + 4;
    page.drawLine({
      start: { x: PAGE.margin, y: y + 6 },
      end: { x: PAGE.margin + 240, y: y + 6 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.65),
    });
    y -= 8;
  } else {
    write(`Agreed electronically: ${input.signerName} typed their name and checked "I have read and agree to this agreement."`);
  }

  y -= 6;
  ensureSpace(110);
  write("SIGNING EVIDENCE", { font: bold, size: 11 });
  write(`Signed at: ${input.signedAtLocal} (${input.signedAtUtc} UTC)`);
  write(`Method: ${input.method === "drawn" ? "Signed on screen" : "Typed name and agreed"}`);
  if (input.staffName) write(`Checkout run by: ${input.staffName}`);
  write(`Agreement version: ${input.templateVersion}`);
  write(`Agreement text SHA-256: ${input.bodySha256}`);
  write(`IP address: ${input.ip ?? "-"}`);
  write(`Device: ${input.userAgent ?? "-"}`);
  write(`Signature record: ${input.signatureId}`);
  return pdf.save();
}
