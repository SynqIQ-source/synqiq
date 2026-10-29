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
//   Leads             all new people (walk-ins, guests, phone-in, web, ...)
//     Contacted       ...with an outbound text, email or logged call
//     Appts made      ...with an appointment booked
//     Shows           ...whose appointment showed
//     Appts closed    ...of those shows, sold in the period
//   Lead sources      new people per "How did you hear about us?" answer
//                     (multi-select, so these can add up to more than Leads)
//   Contacts          calls logged, texts and emails sent in the period --
//                     credited to the staff member who made them (not the
//                     guest's salesperson); failed sends don't count
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
  totals: { guests: number; enrolled: number };
};

type ContactRef = {
  id: string;
  assigned_staff_id: string | null;
  closed_at: string | null;
  created_at: string;
  how_heard: string[] | null;
  source: string;
  referring_client_id: string | null;
  referrer_name_typed: string | null;
  deleted_at: string | null;
  merged_into_id: string | null;
};

const CONTACT_FIELDS =
  "id, assigned_staff_id, closed_at, created_at, how_heard, source, referring_client_id, referrer_name_typed, deleted_at, merged_into_id";
type OutboundRef = { channel: string; contact: ContactRef | null };

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

export async function computeFunnel(
  supabase: ScopedSupabaseClient,
  options: { fromIso: string; toIso: string; staffId: string | null; leadType?: LeadType | null },
): Promise<Funnel> {
  const { fromIso, toIso } = options;
  const inPeriod = (iso: string | null) => Boolean(iso && iso >= fromIso && iso <= toIso);
  const live = (contact: ContactRef | null): contact is ContactRef =>
    Boolean(
      contact &&
        !contact.deleted_at &&
        !contact.merged_into_id &&
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

  const [visits, createdContacts, closedContacts, outbound] = await Promise.all([
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
    all<OutboundRef>((from, to) => {
      let query = supabase
        .from("crm_messages")
        .select(`channel, contact:crm_contacts!crm_messages_contact_id_fkey ( ${CONTACT_FIELDS} )`)
        .eq("direction", "outbound")
        .neq("status", "failed")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      if (options.staffId) query = query.eq("sent_by_staff_id", options.staffId);
      return query.range(from, to).returns<OutboundRef[]>();
    }),
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
  const soldInPeriod = (contacts: Iterable<ContactRef>) => [...contacts].filter((c) => inPeriod(c.closed_at)).length;

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
      supabase.from("crm_messages").select("contact_id").in("contact_id", chunk).eq("direction", "outbound"),
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
    const contact = message.contact;
    if (!contact || (options.leadType && leadTypeOf(contact) !== options.leadType)) continue;
    if (message.channel === "call") activity.calls += 1;
    else if (message.channel === "sms") activity.texts += 1;
    else if (message.channel === "email") activity.emails += 1;
  }

  const everyone = new Set([...walkIns, ...guests, ...appointmentShows, ...returning.values()].map((contact) => contact.id));

  return {
    walkIns: { total: walkIns.length, closed: soldInPeriod(walkIns) },
    guestsOfMembers: { total: guests.length, closed: soldInPeriod(guests) },
    returning: { total: returning.size, closed: soldInPeriod(returning.values()) },
    leads: {
      total: newContacts.length,
      contacted: contacted.size,
      appointments: booked.size,
      shows: showed.size,
      closed: [...showed].filter((id) => soldLeadIds.has(id)).length,
    },
    leadSources,
    activity,
    totals: { guests: everyone.size, enrolled: soldContacts.length },
  };
}

export function percent(count: number, of: number): string {
  if (of === 0) return "—";
  return `${Math.round((count / of) * 100)}%`;
}
