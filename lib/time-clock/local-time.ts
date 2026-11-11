import { DateTime } from "luxon";

// "2026-11-11T08:05" (a datetime-local input) in the studio's time zone ->
// ISO instant, or null when it isn't a valid time.
export function fromLocalInput(value: unknown, timezone: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = DateTime.fromISO(value, { zone: timezone });
  return parsed.isValid ? parsed.toUTC().toISO() : null;
}

// ISO instant -> "2026-11-11T08:05" in the studio's time zone (for inputs).
export function toLocalInput(iso: string | null, timezone: string): string {
  return iso ? DateTime.fromISO(iso).setZone(timezone).toFormat("yyyy-LL-dd'T'HH:mm") : "";
}
