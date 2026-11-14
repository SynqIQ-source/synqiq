import { DateTime } from "luxon";

// Class ratings rules. Pure; unit-tested in tests/ratings.test.ts.

export const WEEKLY_EMAIL_LIMIT = 2;
export const LINK_DAYS = 7;
export const QUEUE_DAYS = 14; // a request not sent within two weeks of the class is dropped
export const LOW_STARS = 3; // at or below: shown to Club Admins as a low rating

// Calendar quarter in the studio's time zone: "2026-Q4".
export function quarterOf(iso: string, zone: string): string {
  const local = DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
  return `${local.year}-Q${Math.ceil(local.month / 3)}`;
}

export function quarterLabel(quarter: string): string {
  const [year, q] = quarter.split("-");
  return `${q} ${year}`;
}

// The quarters of a year, oldest first.
export function quartersOf(year: number): string[] {
  return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
}

export type Visit = { clientId: string; staffId: string; start: string; occurrenceId: string };

// The first class each member took with each instructor in each quarter.
export function firstVisitsByQuarter(visits: Visit[], zone: string): (Visit & { quarter: string })[] {
  const first = new Map<string, Visit & { quarter: string }>();
  for (const visit of visits) {
    const quarter = quarterOf(visit.start, zone);
    const key = `${visit.clientId}|${visit.staffId}|${quarter}`;
    const seen = first.get(key);
    if (!seen || visit.start < seen.start) first.set(key, { ...visit, quarter });
  }
  return [...first.values()];
}

// Which queued requests to email now: oldest class first, at most
// WEEKLY_EMAIL_LIMIT per member counting what they got in the last 7 days.
export function pickToSend<T extends { clientId: string; classStart: string }>(queued: T[], sentThisWeek: Map<string, number>): T[] {
  const used = new Map(sentThisWeek);
  const out: T[] = [];
  for (const request of [...queued].sort((a, b) => a.classStart.localeCompare(b.classStart))) {
    const count = used.get(request.clientId) ?? 0;
    if (count >= WEEKLY_EMAIL_LIMIT) continue;
    used.set(request.clientId, count + 1);
    out.push(request);
  }
  return out;
}

export type Score = { average: number | null; count: number };
export function score(stars: number[]): Score {
  if (!stars.length) return { average: null, count: 0 };
  return { average: Math.round((stars.reduce((sum, value) => sum + value, 0) / stars.length) * 100) / 100, count: stars.length };
}

export function cleanRating(input: { stars: unknown; comment: unknown }): { stars: number; comment: string | null } | { error: string } {
  const stars = Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: "Pick 1 to 5 stars." };
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 2000) : "";
  return { stars, comment: comment || null };
}
