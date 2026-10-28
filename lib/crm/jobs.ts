import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkEmail, EmailCheckRetryableError } from "@/lib/crm/email-check";
import { logCrmError } from "@/lib/crm/http";

// Background work for the CRM (crm_jobs). A job is queued when a contact is
// created, attempted right after the response is sent, and retried by the
// /api/crm/jobs cron with backoff, so a Mailgun (or later Mindbody) outage
// never blocks the kiosk.

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

async function finish(admin: SupabaseClient, job: Job, outcome: { ok: true } | { ok: false; error: string }) {
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

async function runJob(admin: SupabaseClient, job: Job) {
  // mindbody_push isn't built yet; those jobs stay queued untouched.
  if (job.kind !== "email_check") return;
  if (!(await claim(admin, job))) return;
  try {
    await runEmailCheck(admin, job);
    await finish(admin, job, { ok: true });
  } catch (error) {
    if (!(error instanceof EmailCheckRetryableError)) logCrmError(`job ${job.kind}`, error);
    // Error messages here never contain the address.
    const message = error instanceof Error ? error.message.slice(0, 200) : "unknown error";
    await finish(admin, job, { ok: false, error: message });
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
    .eq("kind", "email_check")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at")
    .limit(limit);
  if (error) throw error;

  for (const job of (data ?? []) as Job[]) {
    await runJob(admin, job);
  }
  return { ran: data?.length ?? 0 };
}
