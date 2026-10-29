import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Sales funnel for the Sales dashboard. Everything is a cohort of the
// selected period: "closed" means that guest or lead has enrolled by now
// (crm_contacts.closed_at is set), whenever it happened.
//
//   Walk-ins          guests with a Walk In visit in the period
//   Guests of members guests with a Guest Visit in the period
//   Leads             contacts added by staff (not the kiosk) in the period:
//                     phone-in, web and other sources
//     Contacted       ...with an outbound text, email or logged call
//     Appts made      ...with an appointment booked
//     Shows           ...whose appointment showed
//     Appts closed    ...of those shows, enrolled
//   Total guests      everyone with any visit in the period (walk-ins,
//                     guests of members, appointment shows)
//
// Reads go through the staff member's own session, so RLS scopes them to
// the org. `staffId` narrows everything to one salesperson's guests (the
// contact's assigned salesperson).

export type Rate = { count: number; of: number };

export type Funnel = {
  walkIns: { total: number; closed: number };
  guestsOfMembers: { total: number; closed: number };
  leads: { total: number; contacted: number; appointments: number; shows: number; closed: number };
  totals: { guests: number; enrolled: number };
};

type ContactRef = { id: string; assigned_staff_id: string | null; closed_at: string | null; deleted_at: string | null; merged_into_id: string | null };

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
  options: { fromIso: string; toIso: string; staffId: string | null },
): Promise<Funnel> {
  const live = (contact: ContactRef | null): contact is ContactRef =>
    Boolean(contact && !contact.deleted_at && !contact.merged_into_id && (!options.staffId || contact.assigned_staff_id === options.staffId));

  const visits = await all<{ visit_type: string; contact: ContactRef | null }>((from, to) =>
    supabase
      .from("guest_visits")
      .select("visit_type, contact:crm_contacts!guest_visits_contact_id_fkey ( id, assigned_staff_id, closed_at, deleted_at, merged_into_id )")
      .gte("visit_at", options.fromIso)
      .lte("visit_at", options.toIso)
      .range(from, to)
      .returns<{ visit_type: string; contact: ContactRef | null }[]>(),
  );

  const byType = (types: string[]) => {
    const contacts = new Map<string, ContactRef>();
    for (const visit of visits) {
      if (types.includes(visit.visit_type) && live(visit.contact)) contacts.set(visit.contact.id, visit.contact);
    }
    return [...contacts.values()];
  };
  const closedCount = (contacts: ContactRef[]) => contacts.filter((contact) => contact.closed_at).length;

  const walkIns = byType(["walk_in", "trial_visit"]);
  const guests = byType(["guest_visit"]);
  const everyone = byType(["walk_in", "trial_visit", "guest_visit", "appointment"]);

  const leadRows = await all<ContactRef>((from, to) => {
    let query = supabase
      .from("crm_contacts")
      .select("id, assigned_staff_id, closed_at, deleted_at, merged_into_id")
      .is("created_by_kiosk_device_id", null)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .gte("created_at", options.fromIso)
      .lte("created_at", options.toIso);
    if (options.staffId) query = query.eq("assigned_staff_id", options.staffId);
    return query.range(from, to).returns<ContactRef[]>();
  });
  const leadIds = leadRows.map((lead) => lead.id);

  let contacted = new Set<string>();
  let booked = new Set<string>();
  let showed = new Set<string>();
  // .in() with very long lists makes for very long URLs; chunk it.
  for (let index = 0; index < leadIds.length; index += 200) {
    const chunk = leadIds.slice(index, index + 200);
    const [messages, appointments] = await Promise.all([
      supabase.from("crm_messages").select("contact_id").in("contact_id", chunk).eq("direction", "outbound"),
      supabase.from("crm_appointments").select("contact_id, status").in("contact_id", chunk).neq("status", "canceled"),
    ]);
    if (messages.error) throw messages.error;
    if (appointments.error) throw appointments.error;
    contacted = new Set([...contacted, ...(messages.data ?? []).map((row) => row.contact_id)]);
    booked = new Set([...booked, ...(appointments.data ?? []).map((row) => row.contact_id)]);
    showed = new Set([
      ...showed,
      ...(appointments.data ?? []).filter((row) => row.status === "showed").map((row) => row.contact_id),
    ]);
  }
  const closedLeads = new Set(leadRows.filter((lead) => lead.closed_at).map((lead) => lead.id));

  return {
    walkIns: { total: walkIns.length, closed: closedCount(walkIns) },
    guestsOfMembers: { total: guests.length, closed: closedCount(guests) },
    leads: {
      total: leadRows.length,
      contacted: contacted.size,
      appointments: booked.size,
      shows: showed.size,
      closed: [...showed].filter((id) => closedLeads.has(id)).length,
    },
    totals: { guests: everyone.length, enrolled: closedCount(everyone) },
  };
}

export function percent(count: number, of: number): string {
  if (of === 0) return "—";
  return `${Math.round((count / of) * 100)}%`;
}
