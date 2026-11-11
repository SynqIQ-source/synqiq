// What a key-card scanner sends. Most front-desk scanners act like a
// keyboard: they type the card's number and press Enter. Some add a prefix
// or suffix character, or leading zeros. Returns the bare code, or "" if
// nothing usable was read.
export function normalizeCardCode(raw: string): string {
  const trimmed = raw.trim().replace(/^[;%]+|[?]+$/g, ""); // magstripe sentinels
  const code = trimmed.replace(/[^\w-]/g, "");
  if (!code || code.length > 40) return "";
  // Numeric cards are often zero-padded to a fixed width.
  return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, "") : code;
}
