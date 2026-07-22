import {
  Inter,
  Manrope,
  Work_Sans,
  Sora,
  Lexend,
  Plus_Jakarta_Sans,
  DM_Sans,
  Outfit,
} from "next/font/google";

// next/font/google is a build-time macro -- it can't take a runtime string,
// so every allowlisted font has to be statically imported here regardless
// of which one any given org actually uses. Self-hosted (no request to
// Google's CDN at runtime), matching Next's own recommendation, at the cost
// of every page shipping font assets for all 8 fonts rather than just the
// one in use -- accepted tradeoff, see conversation history.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-work-sans", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const lexend = Lexend({ subsets: ["latin"], variable: "--font-lexend", display: "swap" });
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

// Mirrors the organizations.font_family CHECK constraint exactly -- keep
// these two lists in sync if the allowlist ever changes.
export const ALLOWED_FONTS = [
  "Inter",
  "Manrope",
  "Work Sans",
  "Sora",
  "Lexend",
  "Plus Jakarta Sans",
  "DM Sans",
  "Outfit",
] as const;

export type AllowedFont = (typeof ALLOWED_FONTS)[number];

export function isAllowedFont(value: string): value is AllowedFont {
  return (ALLOWED_FONTS as readonly string[]).includes(value);
}

// Applied to <body>'s className so every font's CSS variable is defined and
// available, regardless of which one is actually selected for --font-body.
export const FONT_VARIABLE_CLASS_NAMES = [
  inter.variable,
  manrope.variable,
  workSans.variable,
  sora.variable,
  lexend.variable,
  plusJakartaSans.variable,
  dmSans.variable,
  outfit.variable,
].join(" ");

export const FONT_CSS_VAR_BY_NAME: Record<AllowedFont, string> = {
  Inter: "var(--font-inter)",
  Manrope: "var(--font-manrope)",
  "Work Sans": "var(--font-work-sans)",
  Sora: "var(--font-sora)",
  Lexend: "var(--font-lexend)",
  "Plus Jakarta Sans": "var(--font-plus-jakarta-sans)",
  "DM Sans": "var(--font-dm-sans)",
  Outfit: "var(--font-outfit)",
};
