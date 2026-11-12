// Trainer calendar rules. Pure; unit-tested in tests/trainer-rules.test.ts.
//
// Anyone on staff can book a trainer inside the trainer's available hours
// (sales, leads, admins, other trainers, the desk). Outside them, or on top
// of another session, only the trainer themself or a Club Admin can book,
// with a reason. Semi-private sessions can share a time slot.

export type Who = { id: string; role: string; isTrainer: boolean };
export type Block = { startsAt: string; endsAt: string; sessionTypeIds: number[] | null };
export type Busy = { id: string; startsAt: string; endsAt: string; sessionTypeId: number | null };

export const SEMI_PRIVATE_TYPE_IDS = new Set([26, 35]); // Semi-Private Training, Semi-Private Pilates

export const canOverride = (who: Who, trainerId: string) => who.role === "admin" || who.id === trainerId;
// Complete / no-show / cancel: the trainer, or a Club Admin / Sales Lead.
export const canCloseSession = (who: Who, trainerId: string) => who.role === "admin" || who.role === "sales_lead" || who.id === trainerId;
// Undo a completed session (voids its payroll event): Club Admin only.
export const canReopenSession = (who: Who) => who.role === "admin";
// Set a trainer's hours: the trainer or a Club Admin.
export const canEditAvailability = (who: Who, trainerId: string) => who.role === "admin" || who.id === trainerId;

const ms = (iso: string) => Date.parse(iso);
const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) =>
  ms(a.startsAt) < ms(b.endsAt) && ms(b.startsAt) < ms(a.endsAt);

// Inside the trainer's hours: covered end to end by availability blocks
// (touching blocks join up) that allow this session type.
export function withinAvailability(slot: { startsAt: string; endsAt: string }, sessionTypeId: number | null, blocks: Block[]): boolean {
  const usable = blocks
    .filter((block) => !block.sessionTypeIds || sessionTypeId == null || block.sessionTypeIds.includes(sessionTypeId))
    .map((block) => [ms(block.startsAt), ms(block.endsAt)] as const)
    .sort((a, b) => a[0] - b[0]);
  let reached = ms(slot.startsAt);
  const end = ms(slot.endsAt);
  for (const [from, to] of usable) {
    if (from > reached) break;
    if (to > reached) reached = to;
    if (reached >= end) return true;
  }
  return reached >= end;
}

// Sessions this one would collide with. Semi-private sessions at the same
// start time are one shared slot, not a collision.
export function conflictsWith(
  slot: { startsAt: string; endsAt: string; sessionTypeId: number | null },
  busy: Busy[],
  excludeId?: string,
): Busy[] {
  return busy.filter((other) => {
    if (other.id === excludeId || !overlaps(slot, other)) return false;
    const shared =
      slot.sessionTypeId != null &&
      SEMI_PRIVATE_TYPE_IDS.has(slot.sessionTypeId) &&
      other.sessionTypeId === slot.sessionTypeId &&
      ms(other.startsAt) === ms(slot.startsAt);
    return !shared;
  });
}

export type BookingCheck = { ok: true; warnings: string[] } | { ok: false; error: string; needsReason?: boolean };

// Can `who` book this slot for the trainer?
export function checkBooking(input: {
  who: Who;
  trainerId: string;
  slot: { startsAt: string; endsAt: string; sessionTypeId: number | null };
  blocks: Block[];
  busy: Busy[];
  now: Date;
  reason: string;
  covered: boolean;
}): BookingCheck {
  const { who, trainerId, slot, reason } = input;
  if (ms(slot.endsAt) <= ms(slot.startsAt)) return { ok: false, error: "The session has to end after it starts." };
  const override = canOverride(who, trainerId);
  const warnings: string[] = [];
  if (ms(slot.endsAt) <= input.now.getTime() - 24 * 3_600_000) {
    if (!override) return { ok: false, error: "That's more than a day ago. Ask the trainer or a Club Admin to add it." };
  }
  if (!withinAvailability(slot, slot.sessionTypeId, input.blocks)) {
    if (!override) return { ok: false, error: "That time is outside the trainer's available hours." };
    if (!reason) return { ok: false, needsReason: true, error: "That's outside the available hours. Add a reason to book it anyway." };
    warnings.push("Outside available hours");
  }
  const clashes = conflictsWith(slot, input.busy);
  if (clashes.length) {
    if (!override) return { ok: false, error: "The trainer already has a session then." };
    if (!reason) return { ok: false, needsReason: true, error: "The trainer already has a session then. Add a reason to double-book." };
    warnings.push("Double-booked");
  }
  if (!input.covered && !reason) {
    return { ok: false, needsReason: true, error: "Nothing on the client's account covers this session. Add a reason to book anyway." };
  }
  return { ok: true, warnings };
}

export type CloseAction = "complete" | "no_show" | "cancel" | "late_cancel";

// What closing a booked session does. Completed and charged no-shows earn
// the trainer their session pay (a payroll event on the session's date); a
// cancel or late cancel doesn't. Completing or marking a no-show can't happen
// before the session starts.
export function closeSession(input: {
  status: string;
  action: CloseAction;
  startsAt: string;
  now: Date;
}):
  | { ok: true; status: "completed" | "no_show" | "cancelled" | "late_cancelled"; pays: boolean; noShow: boolean }
  | { ok: false; error: string } {
  if (input.status !== "booked") return { ok: false, error: "This session is already closed out." };
  const started = input.now.getTime() >= ms(input.startsAt);
  if ((input.action === "complete" || input.action === "no_show") && !started) {
    return { ok: false, error: "You can complete a session once it has started." };
  }
  if (input.action === "complete") return { ok: true, status: "completed", pays: true, noShow: false };
  if (input.action === "no_show") return { ok: true, status: "no_show", pays: true, noShow: true };
  if (input.action === "late_cancel") return { ok: true, status: "late_cancelled", pays: false, noShow: false };
  return { ok: true, status: "cancelled", pays: false, noShow: false };
}

export const SESSION_STATUS_LABELS: Record<string, string> = {
  booked: "Booked",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
  late_cancelled: "Late cancel",
};
