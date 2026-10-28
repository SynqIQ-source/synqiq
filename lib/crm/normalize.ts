import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { DateTime } from "luxon";

// Normalized before matching and before storing (requirement 8).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

// E.164, US by default ("(713) 555-0100" -> "+17135550100").
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 40) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), "US");
  return parsed && parsed.isValid() ? parsed.number : null;
}

export function formatPhoneForDisplay(e164: string | null): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? (parsed.country === "US" ? parsed.formatNational() : parsed.formatInternational()) : e164;
}

// Trimmed, single-spaced, bounded free text; null when empty or too long.
export function cleanText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\s+/g, " ");
  return value.length > 0 && value.length <= maxLength ? value : null;
}

export function cleanState(raw: unknown): string | null {
  const value = cleanText(raw, 2)?.toUpperCase() ?? null;
  return value && /^[A-Z]{2}$/.test(value) ? value : null;
}

export function cleanZip(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return /^\d{5}(-\d{4})?$/.test(value) ? value : null;
}

// ISO date (YYYY-MM-DD) that's a real, past date within a sane range.
export function cleanDateOfBirth(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const date = DateTime.fromISO(raw.trim(), { zone: "utc" });
  if (!date.isValid || raw.trim().length !== 10) return null;
  const now = DateTime.utc();
  return date < now && date > now.minus({ years: 120 }) ? date.toISODate() : null;
}

// Under 18 as of today in the organization's own time zone.
export function isMinor(dateOfBirth: string, timezone: string): boolean {
  const today = DateTime.now().setZone(timezone).startOf("day");
  const dob = DateTime.fromISO(dateOfBirth, { zone: timezone }).startOf("day");
  return dob.plus({ years: 18 }) > today;
}

// "  Jane   van Smith " -> first "Jane", last "van Smith".
export function splitFullName(raw: unknown): { first: string; last: string } | null {
  const value = cleanText(raw, 120);
  if (!value) return null;
  const parts = value.split(" ");
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
}
