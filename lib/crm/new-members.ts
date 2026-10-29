import { DateTime } from "luxon";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { loadIntros, type Intro } from "@/lib/crm/onboarding";

// Members who enrolled in a period, with their trainer, outreach and intro
// status -- for Sales → New Members (admins, everyone) and Follow Up → New
// members (a trainer, only theirs; RLS also limits what they can read).

export type NewMemberRow = {
  id: string;
  name: string;
  enrolledAt: string;
  enrollmentPending: boolean;
  membership: string | null;
  soldById: string | null;
  trainerId: string | null;
  assignedAt: string | null;
  // First outbound text/email/call by the trainer since assignment.
  firstContactAt: string | null;
  lastContactAt: string | null;
  contactCount: number;
  unread: number;
  intro: Intro;
};

export type NewMemberStats = {
  enrolled: number;
  assigned: number;
  contacted: number;
  contactedWithin48h: number;
  introBooked: number; // booked or done
  introDone: number;
};

type MemberContact = {
  id: string;
  first_name: string;
  last_name: string;
  member_enrolled_at: string;
  enrollment_status: string | null;
  membership_name: string | null;
  membership_sold_by_staff_id: string | null;
  trainer_staff_id: string | null;
  trainer_assigned_at: string | null;
  mindbody_client_id: string | null;
};

export async function loadNewMembers(
  supabase: ScopedSupabaseClient,
  options: { fromIso: string; toIso: string; trainerStaffId?: string | null; introSessionTypeId: number | null },
): Promise<NewMemberRow[]> {
  let query = supabase
    .from("crm_contacts")
    .select(
      "id, first_name, last_name, member_enrolled_at, enrollment_status, membership_name, membership_sold_by_staff_id, trainer_staff_id, trainer_assigned_at, mindbody_client_id",
    )
    .not("member_enrolled_at", "is", null)
    .gte("member_enrolled_at", options.fromIso)
    .lte("member_enrolled_at", options.toIso)
    .is("deleted_at", null)
    .is("merged_into_id", null)
    .order("member_enrolled_at", { ascending: false })
    .limit(2000);
  if (options.trainerStaffId === "unassigned") query = query.is("trainer_staff_id", null);
  else if (options.trainerStaffId) query = query.eq("trainer_staff_id", options.trainerStaffId);
  const { data, error } = await query.returns<MemberContact[]>();
  if (error) throw error;
  const contacts = data ?? [];

  const ids = contacts.map((contact) => contact.id);
  const messages: {
    contact_id: string;
    direction: string;
    sent_by_staff_id: string | null;
    read_at: string | null;
    created_at: string;
  }[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const { data: rows, error: messageError } = await supabase
      .from("crm_messages")
      .select("contact_id, direction, sent_by_staff_id, read_at, created_at")
      .in("contact_id", ids.slice(index, index + 200))
      .neq("status", "failed")
      .order("created_at");
    if (messageError) throw messageError;
    messages.push(...(rows ?? []));
  }

  const intros = await loadIntros(supabase, options.introSessionTypeId, contacts);

  return contacts.map((contact) => {
    const mine = messages.filter((m) => m.contact_id === contact.id);
    const outreach = mine.filter(
      (m) =>
        m.direction === "outbound" &&
        contact.trainer_staff_id !== null &&
        m.sent_by_staff_id === contact.trainer_staff_id &&
        (!contact.trainer_assigned_at || m.created_at >= contact.trainer_assigned_at),
    );
    return {
      id: contact.id,
      name: `${contact.first_name} ${contact.last_name}`.trim(),
      enrolledAt: contact.member_enrolled_at,
      enrollmentPending: contact.enrollment_status === "pending",
      membership: contact.membership_name,
      soldById: contact.membership_sold_by_staff_id,
      trainerId: contact.trainer_staff_id,
      assignedAt: contact.trainer_assigned_at,
      firstContactAt: outreach[0]?.created_at ?? null,
      lastContactAt: outreach.at(-1)?.created_at ?? null,
      contactCount: outreach.length,
      unread: mine.filter((m) => m.direction === "inbound" && !m.read_at).length,
      intro: intros.get(contact.id) ?? { status: "none", at: null, trainerStaffId: null },
    };
  });
}

export function newMemberStats(rows: NewMemberRow[]): NewMemberStats {
  return {
    enrolled: rows.length,
    assigned: rows.filter((row) => row.trainerId).length,
    contacted: rows.filter((row) => row.firstContactAt).length,
    contactedWithin48h: rows.filter(
      (row) =>
        row.firstContactAt &&
        row.assignedAt &&
        DateTime.fromISO(row.firstContactAt).diff(DateTime.fromISO(row.assignedAt), "hours").hours <= 48,
    ).length,
    introBooked: rows.filter((row) => row.intro.status === "booked" || row.intro.status === "done").length,
    introDone: rows.filter((row) => row.intro.status === "done").length,
  };
}
