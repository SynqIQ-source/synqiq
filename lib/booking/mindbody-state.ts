// What Mindbody should have for a SynqIQ booking (Dec 10 transition write-
// back). Pure.

export type MindbodyState = "in" | "waitlist" | "out";

// Booked, checked in or a no-show all hold a spot in the class; cancelled and
// late-cancelled don't.
export function desiredMindbodyState(status: string): MindbodyState {
  if (status === "waitlisted") return "waitlist";
  if (status === "cancelled" || status === "late_cancelled") return "out";
  return "in";
}

export type PushStep = { action: "add"; waitlist: boolean } | { action: "remove"; lateCancel: boolean } | { action: "none" };

// The Mindbody call that takes it from what it has to what it should have.
export function pushStep(current: MindbodyState | null, status: string): PushStep {
  const want = desiredMindbodyState(status);
  const have = current ?? "out";
  if (want === have) return { action: "none" };
  if (want === "out") return { action: "remove", lateCancel: status === "late_cancelled" };
  return { action: "add", waitlist: want === "waitlist" };
}

// Whether write-back runs today (studio switch on, on or before the cut-off).
export function writebackActive(enabled: boolean, until: string | null, today: string): boolean {
  return enabled && (!until || today <= until);
}

// Mindbody's booked count already includes SynqIQ bookings it has synced
// since the push; don't count those twice.
export function capacityTaken(mindbodyBooked: number | null, pushedAlreadyCounted: number, synqiqActive: number): number {
  return Math.max(0, (mindbodyBooked ?? 0) - pushedAlreadyCounted) + synqiqActive;
}
