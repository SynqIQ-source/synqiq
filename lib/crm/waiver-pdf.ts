import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type WaiverPdfInput = {
  organizationName: string;
  templateVersion: number;
  templateSha256: string;
  waiverText: string;
  signer: {
    fullName: string;
    typedName: string;
    dateOfBirth: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  isMinor: boolean;
  guardianName: string | null;
  signaturePng: Uint8Array;
  guardianSignaturePng: Uint8Array | null;
  signedAtLocal: string; // e.g. "Oct 28, 2026, 6:05:12 PM CDT"
  signedAtUtc: string; // ISO
  ip: string | null;
  userAgent: string | null;
  signatureId: string;
};

const PAGE = { width: 612, height: 792, margin: 54 }; // US Letter, 0.75in margins
const BODY_SIZE = 9.5;
const LINE = 13;

// Standard fonts use WinAnsi encoding, which includes curly quotes, dashes and
// the ellipsis -- those are kept so the PDF shows exactly the signed text.
// Anything outside WinAnsi becomes "?" so a stray character can't make PDF
// generation throw.
function toWinAnsi(text: string): string {
  return text.replace(/[^\t\n\r\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2022\u20AC]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Renders the signed waiver: the exact waiver text that was shown, the
// signer's details, signature image(s) and the signing evidence.
export async function buildWaiverPdf(input: WaiverPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Signed waiver - ${toWinAnsi(input.signer.fullName)}`);
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

  const write = (text: string, options: { font?: PDFFont; size?: number; color?: [number, number, number] } = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? BODY_SIZE;
    for (const line of wrap(toWinAnsi(text), font, size, textWidth)) {
      ensureSpace(LINE);
      if (line) {
        page.drawText(line, { x: PAGE.margin, y, size, font, color: rgb(...(options.color ?? [0.1, 0.1, 0.12])) });
      }
      y -= size > BODY_SIZE ? size + 5 : LINE;
    }
  };

  write(input.organizationName, { font: bold, size: 14 });
  write(`Signed waiver - version ${input.templateVersion}`, { size: 10, color: [0.35, 0.35, 0.4] });
  y -= 8;
  write(input.waiverText);
  y -= 14;

  ensureSpace(140);
  write("SIGNER", { font: bold, size: 11 });
  const details: [string, string | null][] = [
    ["Name", input.signer.fullName],
    ["Typed name (agreed)", input.signer.typedName],
    ["Date of birth", input.signer.dateOfBirth],
    ["Email", input.signer.email],
    ["Phone", input.signer.phone],
    ["Address", input.signer.address],
  ];
  for (const [label, value] of details) {
    write(`${label}: ${value ?? "-"}`);
  }

  const drawSignature = async (label: string, png: Uint8Array) => {
    const image = await pdf.embedPng(png);
    const scale = Math.min(220 / image.width, 80 / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    ensureSpace(height + 30);
    y -= 6;
    write(label, { font: bold });
    page.drawImage(image, { x: PAGE.margin, y: y - height + 8, width, height });
    y -= height + 4;
    page.drawLine({
      start: { x: PAGE.margin, y: y + 6 },
      end: { x: PAGE.margin + 240, y: y + 6 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.65),
    });
    y -= 8;
  };

  await drawSignature("Signature", input.signaturePng);

  if (input.isMinor && input.guardianSignaturePng) {
    y -= 4;
    write("The signer is under 18. Parent or guardian consent:", { font: bold });
    write(`Parent/guardian name: ${input.guardianName ?? "-"}`);
    await drawSignature("Parent/guardian signature", input.guardianSignaturePng);
  }

  y -= 6;
  ensureSpace(110);
  write("SIGNING EVIDENCE", { font: bold, size: 11 });
  write(`Signed at: ${input.signedAtLocal} (${input.signedAtUtc} UTC)`);
  write(`Waiver version: ${input.templateVersion}`);
  write(`Waiver text SHA-256: ${input.templateSha256}`);
  write(`IP address: ${input.ip ?? "-"}`);
  write(`Device: ${input.userAgent ?? "-"}`);
  write(`Signature record: ${input.signatureId}`);

  return pdf.save();
}
