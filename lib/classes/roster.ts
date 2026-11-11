// Who is in a class: Mindbody's class visits turned into a roster. Pure;
// unit-tested in tests/class-roster.test.ts.

export type MindbodyRosterVisit = {
  ClientId?: string | null;
  ClientUniqueId?: number | null;
  SignedIn?: boolean | null;
  LateCancelled?: boolean | null;
  Missed?: boolean | null;
  WebSignup?: boolean | null;
  ServiceName?: string | null;
  MakeUp?: boolean | null;
};

export type RosterStatus = "checked_in" | "booked" | "late_cancel" | "no_show";
export type RosterEntry = {
  mindbodyClientId: string | null;
  uniqueId: number | null;
  name: string;
  status: RosterStatus;
  paidWith: string | null;
  bookedOnline: boolean;
};

export const ROSTER_LABELS: Record<RosterStatus, string> = {
  checked_in: "Checked in",
  booked: "Booked",
  late_cancel: "Late cancel",
  no_show: "No-show",
};

export function rosterStatus(visit: Pick<MindbodyRosterVisit, "SignedIn" | "LateCancelled" | "Missed">): RosterStatus {
  if (visit.LateCancelled) return "late_cancel";
  if (visit.SignedIn) return "checked_in";
  if (visit.Missed) return "no_show";
  return "booked";
}

const ORDER: Record<RosterStatus, number> = { checked_in: 0, booked: 1, no_show: 2, late_cancel: 3 };

// One entry per client (a client can appear twice, e.g. re-booked after a
// late cancel; the best status wins), sorted by status then name.
export function buildRoster(visits: MindbodyRosterVisit[], nameFor: (visit: MindbodyRosterVisit) => string): RosterEntry[] {
  const byClient = new Map<string, RosterEntry>();
  visits.forEach((visit, index) => {
    const key = String(visit.ClientUniqueId ?? visit.ClientId ?? `visit-${index}`);
    const entry: RosterEntry = {
      mindbodyClientId: visit.ClientId ?? null,
      uniqueId: visit.ClientUniqueId ?? null,
      name: nameFor(visit),
      status: rosterStatus(visit),
      paidWith: visit.ServiceName ?? null,
      bookedOnline: visit.WebSignup === true,
    };
    const existing = byClient.get(key);
    if (!existing || ORDER[entry.status] < ORDER[existing.status]) byClient.set(key, entry);
  });
  return [...byClient.values()].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
}

export function rosterCounts(roster: RosterEntry[]) {
  const counts: Record<RosterStatus, number> = { checked_in: 0, booked: 0, late_cancel: 0, no_show: 0 };
  for (const entry of roster) counts[entry.status] += 1;
  return { ...counts, inClass: counts.checked_in + counts.booked + counts.no_show };
}
