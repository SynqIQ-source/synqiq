import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildNameIndex, type GymSalesActivity, type MatchableContact } from "@/lib/crm/gymsales-activity";

// Imports parsed Gym Sales activity (calls, texts, emails) for a studio:
//   1. match each row to the one lead with that name (shared names skipped);
//   2. save it to crm_imported_activity (re-running never duplicates);
//   3. set each lead's imported_activity_at to their latest activity;
//   4. sort open imported leads: activity (or a SynqIQ message) in the last
//      `activeDays` days stays active; everyone else goes to the warm pool.
// The batch summary records what changed so undoActivityBatch reverses it.

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Contact = MatchableContact & {
  status: string;
  source: string;
  closed_at: string | null;
  import_batch_id: string | null;
  warm_pool_at: string | null;
  last_message_at: string | null;
  follow_up_set_at: string | null;
};

async function loadContacts(admin: Admin, organizationId: string) {
  const contacts: Contact[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("crm_contacts")
      .select("id, first_name, last_name, status, source, closed_at, import_batch_id, warm_pool_at, last_message_at, follow_up_set_at")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    contacts.push(...((data ?? []) as Contact[]));
    if (!data || data.length < 1000) return contacts;
  }
}

export type ActivityImportResult = {
  rows: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  people: number;
  byKind: Record<string, number>;
  activeLeads: number;
  pooledLeads: number;
  batchId: string | null;
};

export async function importGymSalesActivity(input: {
  organizationId: string;
  activities: GymSalesActivity[];
  filenames: string[];
  staffId: string | null;
  activeDays: number;
  apply: boolean;
}): Promise<ActivityImportResult> {
  const admin = createSupabaseAdminClient();
  const contacts = await loadContacts(admin, input.organizationId);
  const match = buildNameIndex(contacts);
  const matched: (GymSalesActivity & { contactId: string })[] = [];
  let ambiguous = 0;
  let unmatched = 0;
  const byKind: Record<string, number> = {};
  for (const activity of input.activities) {
    const found = match(activity.personName);
    if (found && "id" in found) {
      matched.push({ ...activity, contactId: found.id });
      const key = `${activity.kind}_${activity.direction}`;
      byKind[key] = (byKind[key] ?? 0) + 1;
    } else if (found) ambiguous += 1;
    else unmatched += 1;
  }
  const latest = new Map<string, string>();
  for (const activity of matched) {
    if ((latest.get(activity.contactId) ?? "") < activity.at) latest.set(activity.contactId, activity.at);
  }

  // Who stays active: open imported leads with Gym Sales activity, or a
  // SynqIQ message or follow-up date, in the last activeDays days.
  const cutoff = DateTime.now().minus({ days: input.activeDays }).toUTC().toISO()!;
  const openImported = contacts.filter(
    (contact) =>
      contact.import_batch_id &&
      (contact.status === "lead" || contact.status === "guest") &&
      !contact.closed_at &&
      contact.source !== "member",
  );
  const recent = (contact: Contact) =>
    (latest.get(contact.id) ?? "") >= cutoff || (contact.last_message_at ?? "") >= cutoff || (contact.follow_up_set_at ?? "") >= cutoff;
  const toPool = openImported.filter((contact) => !contact.warm_pool_at && !recent(contact)).map((contact) => contact.id);
  const activeLeads = openImported.filter(recent).length;

  const result: ActivityImportResult = {
    rows: input.activities.length,
    matched: matched.length,
    ambiguous,
    unmatched,
    people: latest.size,
    byKind,
    activeLeads,
    pooledLeads: toPool.length,
    batchId: null,
  };
  if (!input.apply) return result;

  const pooledAt = new Date().toISOString();
  const { data: batch, error: batchError } = await admin
    .from("crm_import_batches")
    .insert({
      organization_id: input.organizationId,
      source: "gymsales_activity",
      filename: input.filenames.join(", ").slice(0, 500),
      created_by_staff_id: input.staffId,
      summary: { ...result, activeDays: input.activeDays, pooledAt, pooledContactIds: toPool },
    })
    .select("id")
    .single();
  if (batchError || !batch) throw batchError ?? new Error("Couldn't start the import.");
  const batchId = batch.id as string;

  for (let index = 0; index < matched.length; index += 500) {
    const { error } = await admin.from("crm_imported_activity").upsert(
      matched.slice(index, index + 500).map((activity) => ({
        organization_id: input.organizationId,
        contact_id: activity.contactId,
        import_batch_id: batchId,
        kind: activity.kind,
        direction: activity.direction,
        occurred_at: activity.at,
        outcome: activity.outcome,
        body: activity.body,
        subject: activity.subject,
        sent_by_name: activity.sentBy,
        next_action: activity.nextAction,
        person_name: activity.personName,
        source_key: activity.sourceKey,
      })),
      { onConflict: "organization_id,source_key", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  // Latest activity per lead (only ever moves later).
  for (const [contactId, at] of latest) {
    const { error } = await admin
      .from("crm_contacts")
      .update({ imported_activity_at: at })
      .eq("id", contactId)
      .or(`imported_activity_at.is.null,imported_activity_at.lt."${at}"`);
    if (error) throw error;
  }

  for (let index = 0; index < toPool.length; index += 200) {
    const { error } = await admin
      .from("crm_contacts")
      .update({ warm_pool_at: pooledAt })
      .in("id", toPool.slice(index, index + 200))
      .is("warm_pool_at", null);
    if (error) throw error;
  }
  return { ...result, batchId };
}

// Reverses an activity import: its rows are deleted, latest-activity dates
// recomputed from what's left, and leads it put in the warm pool (and still
// there from that run) taken back out.
export async function undoActivityBatch(organizationId: string, batchId: string, staffId: string | null) {
  const admin = createSupabaseAdminClient();
  const { data: batch } = await admin
    .from("crm_import_batches")
    .select("id, summary, undone_at")
    .eq("id", batchId)
    .eq("organization_id", organizationId)
    .eq("source", "gymsales_activity")
    .maybeSingle();
  if (!batch || batch.undone_at) return { ok: false as const, error: "Import not found or already undone." };
  const summary = (batch.summary ?? {}) as { pooledAt?: string; pooledContactIds?: string[] };
  const contactIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("crm_imported_activity")
      .select("contact_id")
      .eq("import_batch_id", batchId)
      .range(from, from + 999);
    for (const row of data ?? []) contactIds.add(row.contact_id as string);
    if (!data || data.length < 1000) break;
  }
  await admin.from("crm_imported_activity").delete().eq("import_batch_id", batchId);
  for (const contactId of contactIds) {
    const { data: last } = await admin
      .from("crm_imported_activity")
      .select("occurred_at")
      .eq("contact_id", contactId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await admin
      .from("crm_contacts")
      .update({ imported_activity_at: (last?.occurred_at as string | undefined) ?? null })
      .eq("id", contactId);
  }
  const pooled = summary.pooledContactIds ?? [];
  for (let index = 0; summary.pooledAt && index < pooled.length; index += 200) {
    await admin
      .from("crm_contacts")
      .update({ warm_pool_at: null })
      .in("id", pooled.slice(index, index + 200))
      .eq("warm_pool_at", summary.pooledAt);
  }
  await admin.from("crm_import_batches").update({ undone_at: new Date().toISOString(), undone_by_staff_id: staffId }).eq("id", batchId);
  return { ok: true as const };
}
