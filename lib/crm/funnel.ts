import { leadTypeOf, type LeadType } from "@/lib/crm/labels";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Sales funnel for the Sales dashboard. Everything is about the selected
// period, and a sale ("closed") counts in the period it happened:
//
//   New people        contacts entered in the period (any source)
//   Walk-ins          new people whose visit in the period was a Walk In
//   Guests of members new people whose visit was a Guest Visit
//   Returning guests  people entered BEFORE the period who came back (a
//                     visit) or bought in it -- a March tour who buys in
//                     April is an April sale and an April returning guest
//   New leads         all new people (walk-ins, guests, phone-in, web, ...)
//     Contacted       ...with an outbound text, email or logged call (not
//                     failed), sent any time since
//     Appts made      ...with an appointment booked (not canceled)
//     Shows           ...whose appointment showed (Sales History sums)
//     Appts closed    ...of those shows, sold in the period
//   Lead sources      new people per "How did you hear about us?" answer
//                     (multi-select, so these can add up to more than Leads)
//   Contacts          calls logged, texts and emails sent in the period --
//                     credited to the staff member who made them (not the
//                     guest's salesperson); failed sends don't count
//   Appointments      appointments set for a time in the period (not
//                     canceled), how many showed, and of those shows, how
//                     many bought in the period
//   Appts made        appointments booked in the period (not canceled) --
//                     credited to the staff member who booked them
//   Total guests      walk-ins + guests of members + appointment shows in the
//                     period + returning guests (each person once)
//   Enrolled          everyone sold in the period
//
// Each "closed" is sold within the period. Reads go through the staff
// member's own session (RLS scopes them to the org); `staffId` narrows
// everything to one salesperson's guests (the contact's assigned salesperson),
// and `leadType` to people who became a lead that way (walk-in, referral, ...).

export type Funnel = {
  walkIns: { total: number; closed: number };
  guestsOfMembers: { total: number; closed: number };
  returning: { total: number; closed: number };
  leads: { total: number; contacted: number; appointments: number; shows: number; closed: number };
  // Largest first; "Not specified" for people with no answer.
  leadSources: { label: string; count: number }[];
  activity: { calls: number; texts: number; emails: number };
  appointments: { scheduled: number; showed: number; closed: number };
  appointmentsMade: number;
  totals: { guests: number; enrolled: number };
};

type ContactRef = {
  id: string;
  first_name: string;
  last_name: string;
  assigned_staff_id: string | null;
  closed_at: string | null;
  created_at: string;
  how_heard: string[] | null;
  source: string;
  referring_client_id: string | null;
  referrer_name_typed: string | null;
  trainer_staff_id: string | null;
  deleted_at: string | null;
  merged_into_id: string | null;
};

const CONTACT_FIELDS =
  "id, first_name, last_name, assigned_staff_id, closed_at, created_at, how_heard, source, referring_client_id, referrer_name_typed, trainer_staff_id, deleted_at, merged_into_id";
type OutboundRef = {
  channel: string;
  sent_by_staff_id: string | null;
  created_at: string;
  contact: ContactRef | null;
};

export type FunnelOptions = { fromIso: string; toIso: string; staffId: string | null; leadType?: LeadType | null };

const PAGE = 1000;

async function all<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// Texts, emails and logged calls that count as sales contacts in the period
// (the Contacts card and its drill-down).
export async function loadSalesContacts(
  supabase: ScopedSupabaseClient,
  options: FunnelOptions,
): Promise<(OutboundRef & { contact: ContactRef })[]> {
  const outbound = await all<OutboundRef>((from, to) => {
    let query = supabase
      .from("crm_messages")
      .select(`channel, sent_by_staff_id, created_at, contact:crm_contacts!crm_messages_contact_id_fkey ( ${CONTACT_FIELDS} )`)
      .eq("direction", "outbound")
      .neq("status", "failed")
      .gte("created_at", options.fromIso)
      .lte("created_at", options.toIso);
    if (options.staffId) query = query.eq("sent_by_staff_id", options.staffId);
    return query.order("created_at", { ascending: false }).range(from, to).returns<OutboundRef[]>();
  });
  return outbound.filter((message): message is OutboundRef & { contact: ContactRef } => {
    const contact = message.contact;
    // Trainers' outreach to new members isn't sales activity.
    if (!contact || contact.source === "member") return false;
    if (contact.trainer_staff_id && message.sent_by_staff_id === contact.trainer_staff_id) return false;
    return !options.leadType || leadTypeOf(contact) === options.leadType;
  });
}

type AppointmentRef = {
  id: string;
  scheduled_at: string;
  status: string;
  staff_id: string | null;
  created_by_staff_id: string | null;
  created_at: string;
  contact: ContactRef | null;
};
const APPOINTMENT_FIELDS = `id, scheduled_at, status, staff_id, created_by_staff_id, created_at, contact:crm_contacts!crm_appointments_contact_id_fkey ( ${CONTACT_FIELDS} )`;

const leadContact = (contact: ContactRef | null, leadType?: LeadType | null): contact is ContactRef =>
  Boolean(
    contact &&
      !contact.deleted_at &&
      !contact.merged_into_id &&
      contact.source !== "member" &&
      (!leadType || leadTypeOf(contact) === leadType),
  );

// Appointments booked in the period, not canceled, credited to whoever
// booked them (the Appointments made card and its drill-down).
export async function loadAppointmentsMade(
  supabase: ScopedSupabaseClient,
  options: FunnelOptions,
): Promise<(AppointmentRef & { contact: ContactRef })[]> {
  const rows = await all<AppointmentRef>((from, to) => {
    let query = supabase
      .from("crm_appointments")
      .select(APPOINTMENT_FIELDS)
      .neq("status", "canceled")
      .gte("created_at", options.fromIso)
      .lte("created_at", options.toIso);
    if (options.staffId) query = query.eq("created_by_staff_id", options.staffId);
    return query.order("created_at", { ascending: false }).range(from, to).returns<AppointmentRef[]>();
  });
  return rows.filter((row): row is AppointmentRef & { contact: ContactRef } => leadContact(row.contact, options.leadType));
}

export async function computeFunnel(supabase: ScopedSupabaseClient, options: FunnelOptions): Promise<Funnel> {
  return (await computeFunnelLists(supabase, options)).funnel;
}

// The guests (or appointments) behind each dashboard number, for the
// drill-down page. Keys match FUNNEL_LISTS.
export type FunnelLists = {
  contacts: Map<string, ContactRef[]>;
  appointments: Map<string, (AppointmentRef & { contact: ContactRef })[]>;
};
export type FunnelContact = ContactRef;
export type FunnelAppointment = AppointmentRef & { contact: ContactRef };

export const FUNNEL_LISTS: Record<string, string> = {
  walk_ins: "Walk-ins",
  walk_ins_closed: "Walk-ins closed",
  guests: "Guests of members",
  guests_closed: "Guests of members closed",
  returning: "Returning guests",
  returning_closed: "Returning guests closed",
  leads: "Leads",
  leads_contacted: "Leads contacted",
  leads_appointments: "Leads with appointments",
  leads_shows: "Leads who showed",
  leads_closed: "Leads who showed and bought",
  total_guests: "Total guests",
  enrolled: "Enrolled",
  appointments_scheduled: "Appointments scheduled",
  appointments_showed: "Appointments showed",
  appointments_closed: "Appointments closed",
};

export async function computeFunnelLists(
  supabase: ScopedSupabaseClient,
  options: FunnelOptions,
): Promise<{ funnel: Funnel; lists: FunnelLists }> {
  const { fromIso, toIso } = options;
  const inPeriod = (iso: string | null) => Boolean(iso && iso >= fromIso && iso <= toIso);
  const live = (contact: ContactRef | null): contact is ContactRef =>
    Boolean(
      contact &&
        !contact.deleted_at &&
        !contact.merged_into_id &&
        // Members who joined without coming through the CRM aren't leads.
        contact.source !== "member" &&
        (!options.staffId || contact.assigned_staff_id === options.staffId) &&
        (!options.leadType || leadTypeOf(contact) === options.leadType),
    );
  // Live contacts whose `column` timestamp falls in the period (one page).
  const contactsIn = (column: "created_at" | "closed_at", from: number, to: number) => {
    let query = supabase
      .from("crm_contacts")
      .select(CONTACT_FIELDS)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .gte(column, fromIso)
      .lte(column, toIso);
    if (options.staffId) query = query.eq("assigned_staff_id", options.staffId);
    return query.range(from, to).returns<ContactRef[]>();
  };

  const [visits, createdContacts, closedContacts, outbound, appointmentsMade, scheduled] = await Promise.all([
    all<{ visit_type: string; contact: ContactRef | null }>((from, to) =>
      supabase
        .from("guest_visits")
        .select(`visit_type, contact:crm_contacts!guest_visits_contact_id_fkey ( ${CONTACT_FIELDS} )`)
        .gte("visit_at", fromIso)
        .lte("visit_at", toIso)
        .range(from, to)
        .returns<{ visit_type: string; contact: ContactRef | null }[]>(),
    ),
    all<ContactRef>((from, to) => contactsIn("created_at", from, to)),
    all<ContactRef>((from, to) => contactsIn("closed_at", from, to)),
    loadSalesContacts(supabase, options),
    loadAppointmentsMade(supabase, options),
    // Appointments set for the period, by the guest's salesperson.
    all<AppointmentRef>((from, to) =>
      supabase
        .from("crm_appointments")
        .select(APPOINTMENT_FIELDS)
        .neq("status", "canceled")
        .gte("scheduled_at", fromIso)
        .lte("scheduled_at", toIso)
        .range(from, to)
        .returns<AppointmentRef[]>(),
    ),
  ]);
  // The lead-type filter is applied here rather than in SQL ("referral" is
  // derived from the referring member).
  const newContacts = createdContacts.filter(live);
  const soldContacts = closedContacts.filter(live);

  const visitorsOf = (types: string[]) => {
    const contacts = new Map<string, ContactRef>();
    for (const visit of visits) {
      if (types.includes(visit.visit_type) && live(visit.contact)) contacts.set(visit.contact.id, visit.contact);
    }
    return contacts;
  };
  const soldInPeriod = (contacts: Iterable<ContactRef>) => [...contacts].filter((c) => inPeriod(c.closed_at));

  const isNew = (contact: ContactRef) => inPeriod(contact.created_at);
  const walkIns = [...visitorsOf(["walk_in", "trial_visit"]).values()].filter(isNew);
  const guests = [...visitorsOf(["guest_visit"]).values()].filter(isNew);
  const appointmentShows = [...visitorsOf(["appointment"]).values()];

  const returning = new Map<string, ContactRef>();
  for (const contact of visitorsOf(["walk_in", "trial_visit", "guest_visit", "appointment"]).values()) {
    if (!isNew(contact)) returning.set(contact.id, contact);
  }
  for (const contact of soldContacts) {
    if (!isNew(contact)) returning.set(contact.id, contact);
  }

  // Leads funnel over everyone new in the period.
  const leadIds = newContacts.map((contact) => contact.id);
  const contacted = new Set<string>();
  const booked = new Set<string>();
  const showed = new Set<string>();
  // Chunked so the .in() filter stays a reasonable URL length.
  for (let index = 0; index < leadIds.length; index += 200) {
    const chunk = leadIds.slice(index, index + 200);
    const [messages, appointments] = await Promise.all([
      supabase
        .from("crm_messages")
        .select("contact_id")
        .in("contact_id", chunk)
        .eq("direction", "outbound")
        .neq("status", "failed"),
      supabase.from("crm_appointments").select("contact_id, status").in("contact_id", chunk).neq("status", "canceled"),
    ]);
    if (messages.error) throw messages.error;
    if (appointments.error) throw appointments.error;
    for (const row of messages.data ?? []) contacted.add(row.contact_id);
    for (const row of appointments.data ?? []) {
      booked.add(row.contact_id);
      if (row.status === "showed") showed.add(row.contact_id);
    }
  }
  const soldLeadIds = new Set(newContacts.filter((contact) => inPeriod(contact.closed_at)).map((contact) => contact.id));

  const sourceCounts = new Map<string, number>();
  for (const contact of newContacts) {
    const answers = contact.how_heard && contact.how_heard.length > 0 ? contact.how_heard : ["Not specified"];
    for (const answer of new Set(answers)) sourceCounts.set(answer, (sourceCounts.get(answer) ?? 0) + 1);
  }
  const leadSources = [...sourceCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => (a.label === "Not specified" ? 1 : b.label === "Not specified" ? -1 : b.count - a.count || a.label.localeCompare(b.label)));

  const activity = { calls: 0, texts: 0, emails: 0 };
  for (const message of outbound) {
    if (message.channel === "call") activity.calls += 1;
    else if (message.channel === "sms") activity.texts += 1;
    else if (message.channel === "email") activity.emails += 1;
  }

  const scheduledInPeriod = scheduled.filter((row) => live(row.contact));
  const showedInPeriod = scheduledInPeriod.filter((row) => row.status === "showed");

  const everyone = new Map(
    [...walkIns, ...guests, ...appointmentShows, ...returning.values()].map((contact) => [contact.id, contact]),
  );
  const leadsWhere = (ids: Set<string>) => newContacts.filter((contact) => ids.has(contact.id));

  const contactLists = new Map<string, ContactRef[]>([
    ["walk_ins", walkIns],
    ["walk_ins_closed", soldInPeriod(walkIns)],
    ["guests", guests],
    ["guests_closed", soldInPeriod(guests)],
    ["returning", [...returning.values()]],
    ["returning_closed", soldInPeriod(returning.values())],
    ["leads", newContacts],
    ["leads_contacted", leadsWhere(contacted)],
    ["leads_appointments", leadsWhere(booked)],
    ["leads_shows", leadsWhere(showed)],
    ["leads_closed", leadsWhere(showed).filter((contact) => soldLeadIds.has(contact.id))],
    ["total_guests", [...everyone.values()]],
    ["enrolled", soldContacts],
  ]);
  // One list per marketing source ("source:Instagram").
  for (const source of leadSources) {
    contactLists.set(
      `source:${source.label}`,
      newContacts.filter((contact) =>
        source.label === "Not specified"
          ? !contact.how_heard || contact.how_heard.length === 0
          : (contact.how_heard ?? []).includes(source.label),
      ),
    );
  }
  const scheduledLive = scheduledInPeriod as FunnelAppointment[];
  const showedLive = showedInPeriod as FunnelAppointment[];
  const appointmentLists = new Map<string, FunnelAppointment[]>([
    ["appointments_scheduled", scheduledLive],
    ["appointments_showed", showedLive],
    ["appointments_closed", showedLive.filter((row) => inPeriod(row.contact.closed_at))],
  ]);
  const count = (key: string) => contactLists.get(key)!.length;

  return {
    funnel: {
      walkIns: { total: count("walk_ins"), closed: count("walk_ins_closed") },
      guestsOfMembers: { total: count("guests"), closed: count("guests_closed") },
      returning: { total: count("returning"), closed: count("returning_closed") },
      leads: {
        total: count("leads"),
        contacted: count("leads_contacted"),
        appointments: count("leads_appointments"),
        shows: count("leads_shows"),
        closed: count("leads_closed"),
      },
      leadSources,
      activity,
      appointments: {
        scheduled: scheduledLive.length,
        showed: showedLive.length,
        closed: appointmentLists.get("appointments_closed")!.length,
      },
      appointmentsMade: appointmentsMade.length,
      totals: { guests: everyone.size, enrolled: count("enrolled") },
    },
    lists: { contacts: contactLists, appointments: appointmentLists },
  };
}

export function percent(count: number, of: number): string {
  if (of === 0) return "—";
  return `${Math.round((count / of) * 100)}%`;
}
