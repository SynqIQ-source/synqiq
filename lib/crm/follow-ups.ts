import { DateTime } from "luxon";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Lead follow-ups. Nothing is stored as a task: the next follow-up is worked
// out from what already happened, in the club's timezone, by calendar day.
//
//   Not visited yet (lead queue), day 0 = created
//     A follow-up is due every day (the day after the last contact) for the
//     first 7 days, then every 3 days. A no-show or canceled appointment
//     starts the daily week again from then.
//   Visited (visited queue), day 0 = first visit
//     Due 2 days after the last visit or contact for the first 14 days after
//     the first visit, then every 3 days.
//   Paused while an appointment is coming up.
//   Stopped once they enroll, are marked not interested, or reply STOP.
//
// A text, email or logged call (from anyone, not failed) completes the
// follow-up that's due; the next one counts from then. A salesperson can
// reschedule to a date instead, which holds until the next contact or visit.
// Overdue means the due day has passed with no contact.
//
// First contact: the first text, email or call after they came in (their
// first visit, or when they were added if they haven't visited), which
// should be within 48 hours.

export const FIRST_CONTACT_HOURS = 48;
const LEAD_DAILY_DAYS = 7;
const VISITED_EVERY_TWO_DAYS = 14;

export const FOLLOW_UP_CONTACT_FIELDS =
  "id, created_at, status, closed_at, sms_opted_out_at, follow_up_on, follow_up_set_at, assigned_staff_id";

export type FollowUpContact = {
  id: string;
  created_at: string;
  status: string;
  closed_at: string | null;
  sms_opted_out_at: string | null;
  follow_up_on: string | null;
  follow_up_set_at: string | null;
  assigned_staff_id: string | null;
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
};

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

// Visits, outbound contacts and appointments for these contacts, read
// through the staff member's session (chunked to keep .in() URLs short).
export async function loadLeadActivity(
  supabase: ScopedSupabaseClient,
  contactIds: string[],
): Promise<Map<string, LeadActivity>> {
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
        .select("contact_id, channel, created_at")
        .in("contact_id", chunk)
        .eq("direction", "outbound")
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
  | { kind: "stopped"; reason: "enrolled" | "not_interested" | "opted_out" }
  | { kind: "appointment"; at: string }
  | {
      kind: "due";
      queue: FollowUpQueue;
      // ISO date in the club's timezone.
      dueOn: string;
      rescheduled: boolean;
      // Negative = days until due; 0 = due today; positive = days overdue.
      daysOverdue: number;
    };

export function followUpFor(
  contact: FollowUpContact,
  activity: LeadActivity,
  timezone: string,
  now = DateTime.now(),
): FollowUp {
  if (contact.closed_at || contact.status === "member") return { kind: "stopped", reason: "enrolled" };
  if (contact.status === "not_interested") return { kind: "stopped", reason: "not_interested" };
  if (contact.sms_opted_out_at) return { kind: "stopped", reason: "opted_out" };
  if (activity.nextAppointmentAt) return { kind: "appointment", at: activity.nextAppointmentAt };

  const day = (iso: string) => DateTime.fromISO(iso).setZone(timezone).startOf("day");
  const today = now.setZone(timezone).startOf("day");
  const lastContactAt = activity.contactTimes.at(-1) ?? null;
  const queue: FollowUpQueue = activity.firstVisitAt ? "visited" : "lead";

  let due: DateTime;
  let rescheduled = false;
  const lastTouch = later(lastContactAt, activity.lastVisitAt);
  if (contact.follow_up_on && contact.follow_up_set_at && (!lastTouch || lastTouch < contact.follow_up_set_at)) {
    due = DateTime.fromISO(contact.follow_up_on, { zone: timezone }).startOf("day");
    rescheduled = true;
  } else if (activity.firstVisitAt) {
    const anchor = day(later(later(activity.lastVisitAt, lastContactAt), activity.lastMissedAppointmentAt)!);
    const sinceVisit = anchor.diff(day(activity.firstVisitAt), "days").days;
    due = anchor.plus({ days: sinceVisit < VISITED_EVERY_TWO_DAYS ? 2 : 3 });
  } else {
    const start = later(contact.created_at, activity.lastMissedAppointmentAt)!;
    const anchor = day(later(start, lastContactAt)!);
    const sinceStart = anchor.diff(day(start), "days").days;
    due = anchor.plus({ days: sinceStart < LEAD_DAILY_DAYS ? 1 : 3 });
  }

  return {
    kind: "due",
    queue,
    dueOn: due.toISODate()!,
    rescheduled,
    daysOverdue: Math.round(today.diff(due, "days").days),
  };
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
      .not("status", "in", "(member,not_interested)");
    if (staffId === "unassigned") query = query.is("assigned_staff_id", null);
    else if (staffId) query = query.eq("assigned_staff_id", staffId);
    const { data, error } = await query.order("created_at").range(from, from + 999).returns<T[]>();
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
    const followUp = followUpFor(contact, activityFor(activity, contact.id), timezone, now);
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

export const STOPPED_LABELS: Record<string, string> = {
  enrolled: "Enrolled",
  not_interested: "Not interested",
  opted_out: "Replied STOP",
};
