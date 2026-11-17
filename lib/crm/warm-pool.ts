import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  FOLLOW_UP_CONTACT_FIELDS,
  activityFor,
  cadenceFrom,
  followUpFor,
  loadLeadActivity,
  type FollowUpContact,
} from "@/lib/crm/follow-ups";

// Nightly: flag open leads that have had every contact attempt with no reply
// (crm_contacts.warm_pool_at, the date they entered the pool) and unflag
// anyone who has since replied, visited, booked, been given a follow-up date,
// joined or been marked not interested. The follow-up lists work this out
// live; the flag is what Lead Status' Warm pool view and (later) marketing
// audiences read.
export async function runWarmPool(organizationId: string) {
  const admin = createSupabaseAdminClient();
  // Read directly (not getCrmOrg): this runs from a cron, outside React.
  const { data: orgRow, error: orgError } = await admin
    .from("organizations")
    .select("timezone, follow_up_cadence")
    .eq("id", organizationId)
    .single();
  if (orgError || !orgRow) throw orgError ?? new Error("organization not found");
  const org = { timezone: (orgRow.timezone as string | null) ?? "America/Chicago", cadence: cadenceFrom(orgRow.follow_up_cadence) };

  const contacts: (FollowUpContact & { warm_pool_at: string | null })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("crm_contacts")
      .select(FOLLOW_UP_CONTACT_FIELDS)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .is("closed_at", null)
      .is("sms_opted_out_at", null)
      .neq("source", "member")
      .not("status", "in", "(member,not_interested)")
      .or(
        "import_batch_id.is.null,last_message_at.not.is.null,follow_up_on.not.is.null,imported_activity_at.not.is.null,warm_pool_at.not.is.null",
      )
      .order("created_at")
      .range(from, from + 999)
      .returns<(FollowUpContact & { warm_pool_at: string | null })[]>();
    if (error) throw error;
    contacts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const activity = await loadLeadActivity(
    admin,
    contacts.map((contact) => contact.id),
  );
  const now = DateTime.now();
  const enter = new Map<string, string>();
  const pooled = new Set<string>();
  for (const contact of contacts) {
    const followUp = followUpFor(contact, activityFor(activity, contact.id), org.timezone, now, org.cadence);
    if (followUp.kind !== "pool") continue;
    pooled.add(contact.id);
    if (!contact.warm_pool_at) enter.set(contact.id, DateTime.fromISO(followUp.since, { zone: org.timezone }).toUTC().toISO()!);
  }

  // Into the pool, grouped by entry date.
  const byDate = new Map<string, string[]>();
  for (const [id, at] of enter) byDate.set(at, [...(byDate.get(at) ?? []), id]);
  for (const [at, ids] of byDate) {
    for (let index = 0; index < ids.length; index += 200) {
      const { error } = await admin
        .from("crm_contacts")
        .update({ warm_pool_at: at })
        .eq("organization_id", organizationId)
        .in("id", ids.slice(index, index + 200));
      if (error) throw error;
    }
  }

  // Out of the pool: flagged leads that were checked and aren't pooled any
  // more (they replied, visited, booked, were contacted or given a date), or
  // that joined / were marked not interested / were removed. A lead who only
  // opted out of texts stays in the pool (email newsletters are separate).
  const checked = new Set(contacts.map((contact) => contact.id));
  const leave: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: flagged, error: flaggedError } = await admin
      .from("crm_contacts")
      .select("id, status, closed_at, deleted_at, merged_into_id, source")
      .eq("organization_id", organizationId)
      .not("warm_pool_at", "is", null)
      .order("id")
      .range(from, from + 999);
    if (flaggedError) throw flaggedError;
    for (const row of flagged ?? []) {
      const id = row.id as string;
      const closed =
        row.closed_at ||
        row.deleted_at ||
        row.merged_into_id ||
        row.source === "member" ||
        row.status === "member" ||
        row.status === "not_interested";
      if (closed || (checked.has(id) && !pooled.has(id))) leave.push(id);
    }
    if (!flagged || flagged.length < 1000) break;
  }
  for (let index = 0; index < leave.length; index += 200) {
    const { error } = await admin
      .from("crm_contacts")
      .update({ warm_pool_at: null })
      .eq("organization_id", organizationId)
      .in("id", leave.slice(index, index + 200));
    if (error) throw error;
  }
  return { checked: contacts.length, inPool: pooled.size, entered: enter.size, left: leave.length };
}
