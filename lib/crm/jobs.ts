import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkEmail, EmailCheckRetryableError } from "@/lib/crm/email-check";
import { logCrmError } from "@/lib/crm/http";
import { MindbodyPushBlockedError, pushContactToMindbody, sanitizeMindbodyError } from "@/lib/crm/mindbody-push";
import { runMemberContractLookup } from "@/lib/crm/onboarding";
import { loadItemClassifier } from "@/lib/mindbody/item-types";

// Background work for the CRM (crm_jobs). A job is queued when a contact is
// created, attempted right after the response is sent, and retried by the
// /api/crm/jobs cron with backoff, so an email-check or Mindbody outage
// never blocks the kiosk. A finished email check queues the Mindbody push.
// "member_contract" looks up a newly enrolled member's contract start date
// (see lib/crm/onboarding.ts).

const MAX_ATTEMPTS = 6;
// Minutes to wait before attempt N+1.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240, 720];

export async function enqueueEmailCheck(admin: SupabaseClient, organizationId: string, contactId: string) {
  const { data, error } = await admin
    .from("crm_jobs")
    .insert({ organization_id: organizationId, kind: "email_check", contact_id: contactId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// Queues sending a contact to Mindbody and marks it pending on the profile.
export async function enqueueMindbodyPush(admin: SupabaseClient, organizationId: string, contactId: string) {
  const { data, error } = await admin
    .from("crm_jobs")
    .insert({ organization_id: organizationId, kind: "mindbody_push", contact_id: contactId })
    .select("id, organization_id, kind, contact_id, attempts")
    .single();
  if (error) throw error;
  await admin
    .from("crm_contacts")
    .update({ mindbody_sync_status: "pending", mindbody_sync_error: null })
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .is("mindbody_client_id", null);
  return data as Job;
}

type Job = { id: string; organization_id: string; kind: string; contact_id: string; attempts: number };

// Claims a queued job (queued -> running) so two runners can't both take it.
async function claim(admin: SupabaseClient, job: Job): Promise<boolean> {
  const { data, error } = await admin
    .from("crm_jobs")
    .update({ status: "running", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id");
  if (error) throw error;
  return (data ?? []).length === 1;
}

// Returns true when the job won't run again (done, or out of attempts).
async function finish(
  admin: SupabaseClient,
  job: Job,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<boolean> {
  const attempts = job.attempts + 1;
  const now = Date.now();
  const update = outcome.ok
    ? { status: "done", last_error: null }
    : attempts >= MAX_ATTEMPTS
      ? { status: "failed", last_error: outcome.error }
      : {
          status: "queued",
          last_error: outcome.error,
          next_run_at: new Date(now + BACKOFF_MINUTES[attempts - 1] * 60_000).toISOString(),
        };
  await admin
    .from("crm_jobs")
    .update({ ...update, updated_at: new Date(now).toISOString() })
    .eq("id", job.id);
  return update.status !== "queued";
}

async function runEmailCheck(admin: SupabaseClient, job: Job) {
  const { data: contact, error } = await admin
    .from("crm_contacts")
    .select("email_normalized")
    .eq("id", job.contact_id)
    .eq("organization_id", job.organization_id)
    .single();
  if (error) throw error;

  const now = new Date().toISOString();
  if (!contact.email_normalized) {
    await admin
      .from("crm_contacts")
      .update({ email_check_status: "skipped", email_checked_at: now })
      .eq("id", job.contact_id)
      .eq("organization_id", job.organization_id);
    return;
  }

  const outcome = await checkEmail(contact.email_normalized);
  const { error: updateError } = await admin
    .from("crm_contacts")
    .update({
      email_check_status: outcome.status,
      email_check_result: outcome.result,
      email_checked_at: now,
      updated_at: now,
    })
    .eq("id", job.contact_id)
    .eq("organization_id", job.organization_id)
    // Only record the verdict if the email hasn't changed since it was queued.
    .eq("email_normalized", contact.email_normalized);
  if (updateError) throw updateError;
}

async function setMindbodyStatus(admin: SupabaseClient, job: Job, fields: Record<string, unknown>) {
  await admin
    .from("crm_contacts")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", job.contact_id)
    .eq("organization_id", job.organization_id);
}

async function runMindbodyPush(admin: SupabaseClient, job: Job) {
  const result = await pushContactToMindbody(admin, job.contact_id, job.organization_id);
  if ("skipped" in result) {
    await setMindbodyStatus(admin, job, { mindbody_sync_status: "not_synced", mindbody_sync_error: result.skipped });
    return;
  }
  // Linked to someone who's already an Active member: not a new sale.
  let memberAtLink = false;
  if (result.linked && Number.isInteger(Number(result.clientId))) {
    const { data: client } = await admin
      .from("clients")
      .select("status")
      .eq("organization_id", job.organization_id)
      .eq("mindbody_unique_id", Number(result.clientId))
      .maybeSingle();
    memberAtLink = client?.status === "Active";
  }
  await setMindbodyStatus(admin, job, {
    mindbody_client_id: result.clientId,
    mindbody_sync_status: "synced",
    mindbody_synced_at: new Date().toISOString(),
    mindbody_sync_error: null,
    mindbody_member_at_link: memberAtLink,
  });
}

async function runJob(admin: SupabaseClient, job: Job) {
  if (job.kind !== "email_check" && job.kind !== "mindbody_push" && job.kind !== "member_contract") return;
  if (!(await claim(admin, job))) return;

  if (job.kind === "member_contract") {
    try {
      await runMemberContractLookup(admin, job.organization_id, job.contact_id);
      await finish(admin, job, { ok: true });
    } catch (error) {
      logCrmError("job member_contract", error);
      const final = await finish(admin, job, { ok: false, error: sanitizeMindbodyError(error) });
      // Out of retries: keep the day Synq saw them turn Active.
      if (final) {
        await admin
          .from("crm_contacts")
          .update({ enrollment_status: "no_contract" })
          .eq("id", job.contact_id)
          .eq("enrollment_status", "pending");
      }
    }
    return;
  }

  if (job.kind === "email_check") {
    try {
      await runEmailCheck(admin, job);
      await finish(admin, job, { ok: true });
    } catch (error) {
      if (!(error instanceof EmailCheckRetryableError)) logCrmError("job email_check", error);
      // Error messages here never contain the address.
      const message = error instanceof Error ? error.message.slice(0, 200) : "unknown error";
      await finish(admin, job, { ok: false, error: message });
      return;
    }
    // Email checked: send the contact to Mindbody next (a failed or risky
    // check doesn't block the push; staff can fix the email afterwards).
    const push = await enqueueMindbodyPush(admin, job.organization_id, job.contact_id);
    await runJob(admin, push);
    return;
  }

  try {
    await runMindbodyPush(admin, job);
    await finish(admin, job, { ok: true });
  } catch (error) {
    const message = sanitizeMindbodyError(error);
    if (error instanceof MindbodyPushBlockedError) {
      // Needs a staff fix (a field Mindbody requires); retrying won't help.
      await setMindbodyStatus(admin, job, { mindbody_sync_status: "failed", mindbody_sync_error: message });
      await admin.from("crm_jobs").update({ status: "failed", last_error: message }).eq("id", job.id);
      return;
    }
    logCrmError("job mindbody_push", error);
    const final = await finish(admin, job, { ok: false, error: message });
    if (final) await setMindbodyStatus(admin, job, { mindbody_sync_status: "failed", mindbody_sync_error: message });
  }
}

// Runs one specific job now (used right after a check-in).
export async function runJobById(jobId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("crm_jobs")
    .select("id, organization_id, kind, contact_id, attempts")
    .eq("id", jobId)
    .eq("status", "queued")
    .maybeSingle();
  if (data) await runJob(admin, data as Job);
}

// Runs every due job (the cron). Also re-queues jobs stuck in "running" for
// over 10 minutes (a function that died mid-job).
export async function runDueJobs(limit = 50): Promise<{ ran: number }> {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  await admin
    .from("crm_jobs")
    .update({ status: "queued", updated_at: now.toISOString() })
    .eq("status", "running")
    .lt("updated_at", new Date(now.getTime() - 10 * 60_000).toISOString());

  const { data, error } = await admin
    .from("crm_jobs")
    .select("id, organization_id, kind, contact_id, attempts")
    .eq("status", "queued")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at")
    .limit(limit);
  if (error) throw error;

  for (const job of (data ?? []) as Job[]) {
    await runJob(admin, job);
  }
  await detectMindbodyCloses(admin).catch((error) => logCrmError("detect mindbody closes", error));
  return { ran: data?.length ?? 0 };
}

// A guest whose linked Mindbody client bought a membership, or is now an
// Active member, has enrolled: count it as a close ("closed" on the Sales
// dashboard) if staff haven't marked it already. Both read the nightly-synced
// tables, so a close shows up the morning after the sale.
//
// The sale is checked first because a membership can be sold with a future
// start date: the client stays Non-Member in Mindbody until it activates, so
// waiting for Active would count a November sale in December. A sale close
// is dated to the sale and credited to its sales rep. New-member onboarding
// (lib/crm/onboarding.ts) still starts when the client turns Active, i.e.
// on the membership's activation date.
//
// Sales made more than this long before the guest's profile was created
// don't count -- they predate the CRM relationship.
const SALE_BEFORE_PROFILE_SLACK_HOURS = 24;

type OpenContact = { id: string; organization_id: string; mindbody_client_id: string; created_at: string };
type ClientKeys = { organization_id: string; mindbody_unique_id: number; mindbody_client_id: string | null; status: string | null };
type SaleClose = { closedAt: string; repStaffId: string | null };

async function detectMindbodyCloses(admin: SupabaseClient) {
  const { data: openRows, error } = await admin
    .from("crm_contacts")
    .select("id, organization_id, mindbody_client_id, created_at")
    .not("mindbody_client_id", "is", null)
    .eq("mindbody_member_at_link", false)
    .is("closed_at", null)
    .is("deleted_at", null)
    .is("merged_into_id", null)
    .limit(1000);
  if (error) throw error;
  const open = (openRows ?? []) as OpenContact[];
  const ids = open.map((row) => Number(row.mindbody_client_id)).filter((value) => Number.isInteger(value));
  if (ids.length === 0) return;

  // A contact's mindbody_client_id is Mindbody's client Id, which for older
  // clients isn't the UniqueId -- match on either.
  const clientFields = "organization_id, mindbody_unique_id, mindbody_client_id, status";
  const [byUnique, byClientId] = await Promise.all([
    admin.from("clients").select(clientFields).in("mindbody_unique_id", ids),
    admin.from("clients").select(clientFields).in("mindbody_client_id", ids.map(String)),
  ]);
  if (byUnique.error) throw byUnique.error;
  if (byClientId.error) throw byClientId.error;

  // org:id (either id form) -> the client row, so a contact finds its client
  // whichever id it stored, and its sales whichever id they carry.
  const clientByKey = new Map<string, ClientKeys>();
  for (const row of [...(byUnique.data ?? []), ...(byClientId.data ?? [])] as ClientKeys[]) {
    clientByKey.set(`${row.organization_id}:${row.mindbody_unique_id}`, row);
    if (row.mindbody_client_id) clientByKey.set(`${row.organization_id}:${row.mindbody_client_id}`, row);
  }
  const keysFor = (contact: OpenContact) => {
    const client = clientByKey.get(`${contact.organization_id}:${contact.mindbody_client_id}`);
    return new Set(
      [contact.mindbody_client_id, client ? String(client.mindbody_unique_id) : null, client?.mindbody_client_id ?? null].filter(
        (key): key is string => Boolean(key),
      ),
    );
  };

  const saleCloses = await findMembershipSaleCloses(admin, open, keysFor);

  const now = new Date().toISOString();
  for (const contact of open) {
    const sale = saleCloses.get(contact.id);
    const client = clientByKey.get(`${contact.organization_id}:${contact.mindbody_client_id}`);
    const update = sale
      ? { closed_at: sale.closedAt, closed_by_staff_id: sale.repStaffId }
      : client?.status === "Active"
        ? { closed_at: now }
        : null;
    if (!update) continue;
    await admin
      .from("crm_contacts")
      .update({ ...update, close_source: "mindbody", status: "member", updated_at: now })
      .eq("id", contact.id)
      .is("closed_at", null);
  }
}

// Each open contact's earliest membership sale (a sale line tied to a
// Mindbody contract whose name counts as a membership -- Settings ->
// Mindbody items), made no earlier than a day before their profile.
async function findMembershipSaleCloses(
  admin: SupabaseClient,
  open: OpenContact[],
  keysFor: (contact: OpenContact) => Set<string>,
): Promise<Map<string, SaleClose>> {
  const closes = new Map<string, SaleClose>();
  const allKeys = [...new Set(open.flatMap((contact) => [...keysFor(contact)]))];
  type SaleRow = {
    mindbody_sale_id: string;
    organization_id: string;
    client_id: string;
    sale_datetime: string;
    sales_rep_staff_id: string | null;
  };
  const sales: SaleRow[] = [];
  for (let index = 0; index < allKeys.length; index += 200) {
    const { data, error } = await admin
      .from("sales")
      .select("mindbody_sale_id, organization_id, client_id, sale_datetime, sales_rep_staff_id")
      .in("client_id", allKeys.slice(index, index + 200));
    if (error) throw error;
    sales.push(...((data ?? []) as SaleRow[]));
  }
  if (sales.length === 0) return closes;

  // Sales with a membership line, per org (each org has its own item settings).
  const membershipSaleKeys = new Set<string>();
  for (const organizationId of new Set(sales.map((sale) => sale.organization_id))) {
    const saleIds = sales.filter((sale) => sale.organization_id === organizationId).map((sale) => sale.mindbody_sale_id);
    const isMembership = await loadItemClassifier(admin, organizationId, "contract");
    for (let index = 0; index < saleIds.length; index += 200) {
      const { data, error } = await admin
        .from("sale_items")
        .select("mindbody_sale_id, description")
        .eq("organization_id", organizationId)
        .in("mindbody_sale_id", saleIds.slice(index, index + 200))
        .not("client_contract_id", "is", null);
      if (error) throw error;
      for (const item of data ?? []) {
        if (isMembership(item.description as string | null)) {
          membershipSaleKeys.add(`${organizationId}:${item.mindbody_sale_id}`);
        }
      }
    }
  }

  for (const contact of open) {
    const keys = keysFor(contact);
    const earliestAllowed = new Date(
      new Date(contact.created_at).getTime() - SALE_BEFORE_PROFILE_SLACK_HOURS * 3_600_000,
    ).toISOString();
    const earliest = sales
      .filter(
        (sale) =>
          sale.organization_id === contact.organization_id &&
          keys.has(sale.client_id) &&
          membershipSaleKeys.has(`${sale.organization_id}:${sale.mindbody_sale_id}`) &&
          new Date(sale.sale_datetime).toISOString() >= earliestAllowed,
      )
      .sort((a, b) => new Date(a.sale_datetime).getTime() - new Date(b.sale_datetime).getTime())[0];
    if (earliest) {
      closes.set(contact.id, {
        closedAt: new Date(earliest.sale_datetime).toISOString(),
        repStaffId: earliest.sales_rep_staff_id,
      });
    }
  }
  return closes;
}
