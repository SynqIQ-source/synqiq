// Prepaid session packs (PT, intro workouts, class packs). Pure rules,
// shared by the import, booking and close-out code and the tests.

export type PackKind = "pt" | "intro" | "class";

// Mindbody "services" with a huge count are unlimited access (memberships,
// pool lanes), not counted sessions.
export const UNLIMITED_COUNT = 9999;

export function packKind(name: string, program: string | null): PackKind {
  if (/intro/i.test(name)) return "intro";
  if (/personal training|^pt\b/i.test(program ?? "") || /\bpt\b|semi.?private|personal/i.test(name)) return "pt";
  return "class";
}

export function isCountedPack(count: number | null): boolean {
  return count != null && count > 0 && count < UNLIMITED_COUNT;
}

export type PackForBooking = {
  id: string;
  name: string;
  kind: PackKind;
  remaining: number;
  reserved: number; // booked sessions not yet closed
  expiresOn: string | null;
};

export const freeSessions = (pack: PackForBooking) => pack.remaining - pack.reserved;

// The pack a new booking uses: the one expiring soonest that is still valid on
// the session date and has a session free. PT sessions use PT packs first,
// then intro packs.
export function choosePack(packs: PackForBooking[], sessionDate: string, prefer: PackKind[] = ["pt", "intro"]): PackForBooking | null {
  const usable = packs.filter((pack) => freeSessions(pack) > 0 && (!pack.expiresOn || pack.expiresOn >= sessionDate));
  for (const kind of prefer) {
    const match = usable
      .filter((pack) => pack.kind === kind)
      .sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31"))[0];
    if (match) return match;
  }
  return null;
}

// What closing a session takes from the pack (the studio's rules: completed,
// no-show and late cancel each use one; an on-time cancel uses none).
export function sessionsUsed(status: string): number {
  return status === "completed" || status === "no_show" || status === "late_cancelled" ? 1 : 0;
}

export const packUseKind = (status: string) =>
  status === "completed" ? "completed" : status === "no_show" ? "no_show" : status === "late_cancelled" ? "late_cancel" : null;

// Until the studio's switch date, opening balances follow Mindbody.
export const refreshesFromMindbody = (today: string, switchDate: string) => today < switchDate;
