import { DateTime } from "luxon";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Lead follow-ups. Nothing is stored as a task: the next follow-up is worked
// out from what already happened, in the club's timezone, by calendar day.
//
// Contact attempts (the studio's cadence; default, same for every lead):
//   Each outbound text, email or logged call (from anyone, not failed) is an
//   attempt. Attempt 1 is due the day after they come in (within 48 hours);
//   the first `dailyAttempts` attempts are a day apart, then every
//   `everyDays` days, up to `attempts` attempts. Default: day 0, 1, 4, 7, 10,
//   13, 16.
//   A reply (text, email, website form), a visit, or a missed / canceled
//   appointment resets the count; attempts start over from then.
//   No reply `poolAfterDays` days after the last attempt: the lead moves to
//   the warm lead pool (no more follow-ups; newsletter + promotions later).
//   Paused while an appointment is coming up.
//   Stopped once they enroll, are marked not interested, or reply STOP.
//
// A salesperson can reschedule to a date instead, which holds until the next
// contact, reply or visit (and pulls a lead back out of the warm pool).
// Overdue means the due day has passed with no contact.
//
// First contact: the first text, email or call after they came in (their
// first visit, or when they were added if they haven't visited), which
// should be within 48 hours.

export const FIRST_CONTACT_HOURS = 48;

export type FollowUpCadence = { dailyAttempts: number; everyDays: number; attempts: number; poolAfterDays: number };
export const DEFAULT_CADENCE: FollowUpCadence = { dailyAttempts: 2, everyDays: 3, attempts: 7, poolAfterDays: 2 };
export const CADENCE_LIMITS: Record<keyof FollowUpCadence, [number, number]> = {
  dailyAttempts: [1, 10],
  everyDays: [1, 30],
  attempts: [1, 30],
  poolAfterDays: [0, 30],
};

// A stored cadence (organizations.follow_up_cadence), anything missing or out
// of range falling back to the default.
export function cadenceFrom(value: unknown): FollowUpCadence {
  const stored = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const result = { ...DEFAULT_CADENCE };
  for (const key of Object.keys(DEFAULT_CADENCE) as (keyof FollowUpCadence)[]) {
    const number = Number(stored[key]);
    const [min, max] = CADENCE_LIMITS[key];
    if (Number.isInteger(number) && number >= min && number <= max) result[key] = number;
  }
  return result;
}

// The day (after coming in) of each attempt, for showing the schedule.
export function cadenceDays(cadence: FollowUpCadence): number[] {
  const days = [0];
  for (let attempt = 1; attempt < cadence.attempts; attempt += 1) {
    days.push(days[attempt - 1] + (attempt < cadence.dailyAttempts ? 1 : cadence.everyDays));
  }
  return days;
}

export const FOLLOW_UP_CONTACT_FIELDS =
  "id, created_at, status, closed_at, sms_opted_out_at, follow_up_on, follow_up_set_at, assigned_staff_id, import_batch_id, last_message_at";

export type FollowUpContact = {
  id: string;
  created_at: string;
  status: string;
  closed_at: string | null;
  sms_opted_out_at: string | null;
  follow_up_on: string | null;
  follow_up_set_at: string | null;
  assigned_staff_id: string | null;
  // Imported from another system (Gym Sales): no follow-up schedule until
  // someone works the lead in SynqIQ or they reply or visit.
  import_batch_id?: string | null;
  last_message_at?: string | null;
};

export type LeadActivity = {
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  // All outbound texts, emails and logged calls, oldest first.
  contactTimes: string[];
  calls: number;
  texts: number;
  emails: number;
  nextAppointmentAt: string | null;
  // Latest no-show, cancellation, or past appointment nobody marked.
  lastMissedAppointmentAt: string | null;
  // Latest text / email / website form from them.
  lastReplyAt: string | null;
};

const EMPTY_ACTIVITY: LeadActivity = {
  firstVisitAt: null,
  lastVisitAt: null,
  contactTimes: [],
  calls: 0,
  texts: 0,
  emails: 0,
  nextAppointmentAt: null,
  lastMissedAppointmentAt: null,
  lastReplyAt: null,
};

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

// Visits, outbound contacts and appointments for these contacts, read
// through the staff member's session (chunked to keep .in() URLs short).
export async function loadLeadActivity(supabase: ScopedSupabaseClient, contactIds: string[]): Promise<Map<string, LeadActivity>> {
  const activity = new Map<string, LeadActivity>();
  const get = (id: string) => {
    let row = activity.get(id);
    if (!row) {
      row = { ...EMPTY_ACTIVITY, contactTimes: [] };
      activity.set(id, row);
    }
    return row;
  };
  const nowIso = new Date().toISOString();

  for (let index = 0; index < contactIds.length; index += 200) {
    const chunk = contactIds.slice(index, index + 200);
    const [visits, messages, appointments] = await Promise.all([
      supabase.from("guest_visits").select("contact_id, visit_at").in("contact_id", chunk).order("visit_at"),
      supabase
        .from("crm_messages")
        .select("contact_id, channel, created_at, direction")
        .in("contact_id", chunk)
        .neq("status", "failed")
        .order("created_at"),
      supabase.from("crm_appointments").select("contact_id, scheduled_at, status, updated_at").in("contact_id", chunk),
    ]);
    if (visits.error) throw visits.error;
    if (messages.error) throw messages.error;
    if (appointments.error) throw appointments.error;

    for (const visit of visits.data ?? []) {
      const row = get(visit.contact_id);
      row.firstVisitAt ??= visit.visit_at;
      row.lastVisitAt = later(row.lastVisitAt, visit.visit_at);
    }
    for (const message of messages.data ?? []) {
      const row = get(message.contact_id);
      if (message.direction === "inbound") {
        row.lastReplyAt = later(row.lastReplyAt, message.created_at);
        continue;
      }
      row.contactTimes.push(message.created_at);
      if (message.channel === "call") row.calls += 1;
      else if (message.channel === "sms") row.texts += 1;
      else if (message.channel === "email") row.emails += 1;
    }
    for (const appointment of appointments.data ?? []) {
      const row = get(appointment.contact_id);
      const at = appointment.scheduled_at as string;
      if (appointment.status === "showed") {
        // Marked showed without a kiosk check-in still counts as a visit.
        if (!row.firstVisitAt || at < row.firstVisitAt) row.firstVisitAt = at;
        row.lastVisitAt = later(row.lastVisitAt, at);
      } else if (appointment.status === "scheduled" && at > nowIso) {
        if (!row.nextAppointmentAt || at < row.nextAppointmentAt) row.nextAppointmentAt = at;
      } else if (appointment.status === "canceled") {
        // Counts from when it was canceled, not the slot it was booked for.
        const canceledAt = (appointment.updated_at as string) < at ? (appointment.updated_at as string) : at;
        row.lastMissedAppointmentAt = later(row.lastMissedAppointmentAt, canceledAt);
      } else {
        // No-show, or a past appointment still "scheduled".
        row.lastMissedAppointmentAt = later(row.lastMissedAppointmentAt, at);
      }
    }
  }
  return activity;
}

export function activityFor(activity: Map<string, LeadActivity>, contactId: string): LeadActivity {
  return activity.get(contactId) ?? EMPTY_ACTIVITY;
}

// One guest's activity across contacts merged into them (their profile).
export function combinedActivity(activity: Map<string, LeadActivity>, contactIds: string[]): LeadActivity {
  const earlier = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
  return contactIds.reduce<LeadActivity>((total, id) => {
    const row = activityFor(activity, id);
    return {
      firstVisitAt: earlier(total.firstVisitAt, row.firstVisitAt),
      lastVisitAt: later(total.lastVisitAt, row.lastVisitAt),
      contactTimes: [...total.contactTimes, ...row.contactTimes].sort(),
      calls: total.calls + row.calls,
      texts: total.texts + row.texts,
      emails: total.emails + row.emails,
      nextAppointmentAt: earlier(total.nextAppointmentAt, row.nextAppointmentAt),
      lastMissedAppointmentAt: later(total.lastMissedAppointmentAt, row.lastMissedAppointmentAt),
      lastReplyAt: later(total.lastReplyAt, row.lastReplyAt),
    };
  }, EMPTY_ACTIVITY);
}

// --- First contact (the 48-hour rule) ---------------------------------------

export type FirstContact =
  | { state: "on_time" | "late"; cameInAt: string; contactedAt: string; hours: number }
  | { state: "overdue"; cameInAt: string; hours: number }
  | { state: "pending"; cameInAt: string; hoursLeft: number };

export function firstContactFor(contact: FollowUpContact, activity: LeadActivity, now = DateTime.now()): FirstContact {
  const cameInAt = activity.firstVisitAt ?? contact.created_at;
  const contactedAt = activity.contactTimes.find((at) => at >= cameInAt) ?? null;
  const since = DateTime.fromISO(cameInAt);
  if (contactedAt) {
    const hours = DateTime.fromISO(contactedAt).diff(since, "hours").hours;
    return { state: hours <= FIRST_CONTACT_HOURS ? "on_time" : "late", cameInAt, contactedAt, hours };
  }
  const hours = now.diff(since, "hours").hours;
  return hours > FIRST_CONTACT_HOURS
    ? { state: "overdue", cameInAt, hours }
    : { state: "pending", cameInAt, hoursLeft: FIRST_CONTACT_HOURS - hours };
}

// "3h", "1d 4h", "45m".
export function formatHours(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  if (minutes < 60) return `${minutes}m`;
  const wholeHours = Math.floor(minutes / 60);
  if (wholeHours < 24) return `${wholeHours}h`;
  const days = Math.floor(wholeHours / 24);
  const rest = wholeHours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

// --- Next follow-up ----------------------------------------------------------

export type FollowUpQueue = "lead" | "visited";

export type FollowUp =
  | { kind: "stopped"; reason: "enrolled" | "not_interested" | "opted_out" | "imported" }
  | { kind: "appointment"; at: string }
  // All attempts made, no reply yet; moves to the warm pool on poolOn.
  | { kind: "waiting"; poolOn: string; attempts: number }
  // In the warm lead pool since `since` (ISO date).
  | { kind: "pool"; since: string; attempts: number }
  | {
      kind: "due";
      queue: FollowUpQueue;
      // ISO date in the club's timezone.
      dueOn: string;
      rescheduled: boolean;
      // Negative = days until due; 0 = due today; positive = days overdue.
      daysOverdue: number;
      // Which attempt this is (1-based) and how many the cadence makes.
      attempt: number;
      of: number;
    };

export function followUpFor(
  contact: FollowUpContact,
  activity: LeadActivity,
  timezone: string,
  now = DateTime.now(),
  cadence: FollowUpCadence = DEFAULT_CADENCE,
): FollowUp {
  if (contact.closed_at || contact.status === "member") return { kind: "stopped", reason: "enrolled" };
  if (contact.status === "not_interested") return { kind: "stopped", reason: "not_interested" };
  if (contact.sms_opted_out_at) return { kind: "stopped", reason: "opted_out" };
  if (isDormantImport(contact, activity)) return { kind: "stopped", reason: "imported" };
  if (activity.nextAppointmentAt) return { kind: "appointment", at: activity.nextAppointmentAt };

  const day = (iso: string) => DateTime.fromISO(iso).setZone(timezone).startOf("day");
  const today = now.setZone(timezone).startOf("day");
  const lastContactAt = activity.contactTimes.at(-1) ?? null;
  const queue: FollowUpQueue = activity.firstVisitAt ? "visited" : "lead";

  // Attempts since the last reset (came in, replied, visited, missed an
  // appointment).
  const resetAt = [activity.lastReplyAt, activity.lastVisitAt, activity.lastMissedAppointmentAt].reduce(later, contact.created_at)!;
  const attempts = activity.contactTimes.filter((at) => at > resetAt);
  const made = attempts.length;
  const lastAttemptAt = attempts.at(-1) ?? null;

  const result = (due: DateTime, rescheduled: boolean): FollowUp => ({
    kind: "due",
    queue,
    dueOn: due.toISODate()!,
    rescheduled,
    daysOverdue: Math.round(today.diff(due, "days").days),
    attempt: Math.min(made + 1, cadence.attempts),
    of: cadence.attempts,
  });

  const lastTouch = [lastContactAt, activity.lastVisitAt, activity.lastReplyAt].reduce(later, null);
  if (contact.follow_up_on && contact.follow_up_set_at && (!lastTouch || lastTouch < contact.follow_up_set_at)) {
    return result(DateTime.fromISO(contact.follow_up_on, { zone: timezone }).startOf("day"), true);
  }
  if (!lastAttemptAt) return result(day(resetAt).plus({ days: 1 }), false);
  if (made < cadence.attempts) {
    return result(day(lastAttemptAt).plus({ days: made < cadence.dailyAttempts ? 1 : cadence.everyDays }), false);
  }
  const poolOn = day(lastAttemptAt).plus({ days: cadence.poolAfterDays });
  return today >= poolOn
    ? { kind: "pool", since: poolOn.toISODate()!, attempts: made }
    : { kind: "waiting", poolOn: poolOn.toISODate()!, attempts: made };
}

// Open leads whose follow-ups are worked out: not deleted or merged, not
// members who joined without coming through the CRM, not enrolled, not
// marked not interested, not opted out.
export async function loadOpenFollowUpContacts<T extends FollowUpContact>(
  supabase: ScopedSupabaseClient,
  columns: string,
  staffId: string | null,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from("crm_contacts")
      .select(columns)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .is("closed_at", null)
      .is("sms_opted_out_at", null)
      .neq("source", "member")
      .not("status", "in", "(member,not_interested)")
      .or("import_batch_id.is.null,last_message_at.not.is.null,follow_up_on.not.is.null");
    if (staffId === "unassigned") query = query.is("assigned_staff_id", null);
    else if (staffId) query = query.eq("assigned_staff_id", staffId);
    const { data, error } = await query
      .order("created_at")
      .range(from, from + 999)
      .returns<T[]>();
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

// Overdue follow-ups right now, per assigned salesperson ("" = unassigned).
export async function overdueBySeller(
  supabase: ScopedSupabaseClient,
  timezone: string,
  staffId: string | null = null,
  cadence: FollowUpCadence = DEFAULT_CADENCE,
): Promise<{ overdue: Map<string, number>; dueToday: Map<string, number> }> {
  const contacts = await loadOpenFollowUpContacts<FollowUpContact>(supabase, FOLLOW_UP_CONTACT_FIELDS, staffId);
  const activity = await loadLeadActivity(
    supabase,
    contacts.map((contact) => contact.id),
  );
  const overdue = new Map<string, number>();
  const dueToday = new Map<string, number>();
  const now = DateTime.now();
  for (const contact of contacts) {
    const followUp = followUpFor(contact, activityFor(activity, contact.id), timezone, now, cadence);
    if (followUp.kind !== "due" || followUp.daysOverdue < 0) continue;
    const key = contact.assigned_staff_id ?? "";
    const counts = followUp.daysOverdue > 0 ? overdue : dueToday;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { overdue, dueToday };
}

export const QUEUE_LABELS: Record<FollowUpQueue, string> = {
  lead: "Not visited",
  visited: "Visited",
};

// An imported lead nobody has worked in SynqIQ yet: no texts/emails/calls,
// no visit or appointment, no follow-up date set.
export function isDormantImport(contact: FollowUpContact, activity: LeadActivity): boolean {
  return Boolean(
    contact.import_batch_id &&
    !contact.follow_up_on &&
    !contact.last_message_at &&
    activity.contactTimes.length === 0 &&
    !activity.firstVisitAt &&
    !activity.nextAppointmentAt &&
    !activity.lastMissedAppointmentAt,
  );
}

export const STOPPED_LABELS: Record<string, string> = {
  imported: "Imported, not worked yet",
  enrolled: "Enrolled",
  not_interested: "Not interested",
  opted_out: "Replied STOP",
};
