// Decodes and checks the images a kiosk submits as data URLs. The type is
// checked from the file's own magic bytes, not from the data URL's label.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function decodeDataUrl(raw: unknown, mime: string, maxBytes: number): Uint8Array | null {
  if (typeof raw !== "string") return null;
  const prefix = `data:${mime};base64,`;
  if (!raw.startsWith(prefix)) return null;
  const base64 = raw.slice(prefix.length);
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

export function decodePng(raw: unknown, maxBytes = 400_000): Uint8Array | null {
  const bytes = decodeDataUrl(raw, "image/png", maxBytes);
  return bytes && startsWith(bytes, PNG_MAGIC) ? bytes : null;
}

export function decodeJpeg(raw: unknown, maxBytes = 1_500_000): Uint8Array | null {
  const bytes = decodeDataUrl(raw, "image/jpeg", maxBytes);
  return bytes && startsWith(bytes, JPEG_MAGIC) ? bytes : null;
}
