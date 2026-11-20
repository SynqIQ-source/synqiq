// The member app's home-screen identity is the studio's, not SynqIQ's: each
// studio's name, color and logo (or initials until a logo is uploaded).
// Pure helpers shared by the manifest, the icon images and the page metadata.

export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export function studioInitials(name: string): string {
  const words = name
    .replace(/^the\s+/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return "S";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

// Home-screen label: iOS/Android truncate around 12 characters.
export function shortStudioName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 12) return trimmed;
  const withoutThe = trimmed.replace(/^the\s+/i, "");
  return withoutThe.length <= 12 ? withoutThe : withoutThe.split(/\s+/)[0].slice(0, 12);
}

export const safeColor = (value: string | null | undefined) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#0f766e");

export function iconPath(siteId: number, size: IconSize, maskable = false) {
  return `/m/${siteId}/app-icon/${size}${maskable ? "?maskable=1" : ""}`;
}
