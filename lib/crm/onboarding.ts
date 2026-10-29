import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import type { MindbodyClientContract, MindbodyClientRecord } from "@/types/mindbody";

// New-member onboarding. Forward-only: the nightly client sync calls
// recordEnrollments() with the members whose Mindbody status just turned
// Active (no backfill of existing members). Each gets a CRM profile -- the
// existing one when they came through the CRM as a guest, else a new one
// with source "member" -- and a "member_contract" job that looks up their
// contract for the real enrollment date (the contract start date).
// An admin then assigns a trainer, who reaches out to book an Intro
// Workout; intro status comes from the synced Mindbody appointments.

// Someone re-detected within this many days isn't a new enrollment (e.g. a
// status that flapped Active -> Suspended -> Active).
const REENROLL_GAP_DAYS = 30;

type EnrollmentContact = {
  id: string;
  mindbody_client_id: string | null;
  email: string | null;
  phone_e164: string | null;
  enrollment_detected_at: string | null;
};

const LIVE_CONTACT_FIELDS = "id, mindbody_client_id, email, phone_e164, enrollment_detected_at";

async function findContact(
  admin: SupabaseClient,
  organizationId: string,
  keys: { clientIds: string[]; email: string | null; phone: string | null },
): Promise<EnrollmentContact | null> {
  const live = () =>
    admin
      .from("crm_contacts")
      .select(LIVE_CONTACT_FIELDS)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .is("merged_into_id", null);

  const { data: byClient } = await live().in("mindbody_client_id", keys.clientIds).limit(1);
  if (byClient?.[0]) return byClient[0] as EnrollmentContact;
  // Email or phone only when it identifies exactly one profile.
  for (const [column, value] of [
    ["email_normalized", keys.email],
    ["phone_e164", keys.phone],
  ] as const) {
    if (!value) continue;
    const { data } = await live().eq(column, value).limit(2);
    if (data?.length === 1) return data[0] as EnrollmentContact;
  }
  return null;
}

// Members who just turned Active in Mindbody. Small numbers per night.
export async function recordEnrollments(
  admin: SupabaseClient,
  organizationId: string,
  clients: MindbodyClientRecord[],
): Promise<number> {
  if (clients.length === 0) return 0;
  const { data: staffRows } = await admin
    .from("staff")
    .select("id, mindbody_staff_id")
    .eq("organization_id", organizationId);
  const staffByMindbodyId = new Map(
    (staffRows ?? []).map((row) => [row.mindbody_staff_id as number, row.id as string]),
  );

  const now = DateTime.utc();
  let recorded = 0;
  for (const client of clients) {
    const clientId = String(client.Id ?? client.UniqueId);
    const email = normalizeEmail(client.Email);
    const phone = normalizePhone(client.MobilePhone);
    const repId = client.SalesReps?.find((rep) => rep?.Id != null)?.Id;
    const soldBy = repId != null ? (staffByMindbodyId.get(repId) ?? null) : null;

    const existing = await findContact(admin, organizationId, {
      clientIds: [...new Set([clientId, String(client.UniqueId)])],
      email,
      phone,
    });
    if (
      existing?.enrollment_detected_at &&
      now.diff(DateTime.fromISO(existing.enrollment_detected_at), "days").days < REENROLL_GAP_DAYS
    ) {
      continue;
    }

    // Until the contract lookup finishes, "enrolled" is the day Synq saw it.
    const enrollment = {
      status: "member",
      member_enrolled_at: now.toISO(),
      membership_sold_by_staff_id: soldBy,
      enrollment_detected_at: now.toISO(),
      enrollment_status: "pending",
      membership_name: null,
      // A re-enrollment starts a fresh intro: the admin assigns again.
      trainer_staff_id: null,
      trainer_assigned_at: null,
      trainer_assigned_by_staff_id: null,
      updated_at: now.toISO(),
    };

    let contactId: string;
    if (existing) {
      const { error } = await admin
        .from("crm_contacts")
        .update({
          ...enrollment,
          mindbody_client_id: existing.mindbody_client_id ?? clientId,
          ...(existing.email || !client.Email ? {} : { email: client.Email.trim(), email_normalized: email }),
          ...(existing.phone_e164 || !phone ? {} : { phone_e164: phone }),
        })
        .eq("id", existing.id);
      if (error) throw error;
      contactId = existing.id;
    } else {
      const { data, error } = await admin
        .from("crm_contacts")
        .insert({
          organization_id: organizationId,
          first_name: client.FirstName?.trim() || "Member",
          last_name: client.LastName?.trim() || "",
          email: client.Email?.trim() || null,
          email_normalized: email,
          phone_e164: phone,
          source: "member",
          // Text/email permission is Synq's own (given at the kiosk), never
          // copied from Mindbody: a member who never came through Synq starts
          // without it.
          sms_consent: false,
          email_consent: false,
          email_check_status: "skipped",
          mindbody_client_id: clientId,
          mindbody_sync_status: "synced",
          mindbody_synced_at: now.toISO(),
          // Already a member when the profile was made: never a sales close.
          mindbody_member_at_link: true,
          ...enrollment,
        })
        .select("id")
        .single();
      if (error) throw error;
      contactId = data.id as string;
    }

    const { error: jobError } = await admin
      .from("crm_jobs")
      .insert({ organization_id: organizationId, kind: "member_contract", contact_id: contactId });
    if (jobError) throw jobError;
    recorded += 1;
  }
  return recorded;
}

// The "member_contract" job: sets the enrollment date to the start date of
// the member's newest contract. No contract (e.g. a pass rather than a
// membership) keeps the day Synq saw them turn Active.
export async function runMemberContractLookup(admin: SupabaseClient, organizationId: string, contactId: string) {
  const { data: contact, error } = await admin
    .from("crm_contacts")
    .select("mindbody_client_id, enrollment_detected_at, organization:organizations ( timezone )")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .single<{
      mindbody_client_id: string | null;
      enrollment_detected_at: string | null;
      organization: { timezone: string } | null;
    }>();
  if (error) throw error;
  if (!contact.mindbody_client_id) {
    await admin.from("crm_contacts").update({ enrollment_status: "no_contract" }).eq("id", contactId);
    return;
  }

  const mindbody = createMindbodyClient();
  const auth = await mindbody.authenticate();
  const result = await mindbody.getClientContracts(contact.mindbody_client_id, auth.AccessToken);
  const contracts = ((result?.Contracts ?? []) as MindbodyClientContract[]).filter((c) => c.StartDate);
  const timezone = contact.organization?.timezone ?? "utc";

  // Newest contract by start date (then by signing date). A contract that
  // started long before Synq saw them turn Active is from an earlier
  // membership, unless it's the only one.
  contracts.sort((a, b) =>
    `${b.StartDate}${b.AgreementDate ?? ""}`.localeCompare(`${a.StartDate}${a.AgreementDate ?? ""}`),
  );
  const newest = contracts[0];
  const now = new Date().toISOString();
  if (!newest?.StartDate) {
    await admin.from("crm_contacts").update({ enrollment_status: "no_contract", updated_at: now }).eq("id", contactId);
    return;
  }
  const start = DateTime.fromISO(newest.StartDate, { zone: timezone }).startOf("day");
  await admin
    .from("crm_contacts")
    .update({
      member_enrolled_at: start.toUTC().toISO(),
      membership_name: newest.ContractName?.trim() || null,
      enrollment_status: "found",
      updated_at: now,
    })
    .eq("id", contactId);
}

// --- Intro Workout status ------------------------------------------------

export type IntroStatus = "none" | "booked" | "done" | "no_show" | "late_cancel";
export type Intro = { status: IntroStatus; at: string | null; trainerStaffId: string | null };

export const INTRO_LABELS: Record<IntroStatus, string> = {
  none: "Not booked",
  booked: "Intro booked",
  done: "Intro done",
  no_show: "No-show",
  late_cancel: "Late cancel",
};

// Intro status per contact, from Mindbody appointments of the org's intro
// type on or after (enrolled date - 14 days). Completed beats booked beats
// a miss; the most recent of each wins.
export async function loadIntros(
  supabase: SupabaseClient,
  introSessionTypeId: number | null,
  contacts: { id: string; mindbody_client_id: string | null; member_enrolled_at: string | null }[],
): Promise<Map<string, Intro>> {
  const intros = new Map<string, Intro>();
  const byClient = new Map(
    contacts.filter((c) => c.mindbody_client_id).map((c) => [c.mindbody_client_id as string, c] as const),
  );
  if (!introSessionTypeId || byClient.size === 0) return intros;

  const ids = [...byClient.keys()];
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await supabase
      .from("appointment_occurrences")
      .select("client_id, status, start_datetime, staff_id")
      .eq("session_type_id", introSessionTypeId)
      .in("client_id", ids.slice(index, index + 200))
      .order("start_datetime", { ascending: false });
    if (error) throw error;
    for (const row of data ?? []) {
      const contact = byClient.get(row.client_id as string);
      if (!contact) continue;
      const since = contact.member_enrolled_at
        ? DateTime.fromISO(contact.member_enrolled_at).minus({ days: 14 }).toISO()!
        : null;
      if (since && (row.start_datetime as string) < since) continue;
      const status: IntroStatus =
        row.status === "Completed" || row.status === "Arrived"
          ? "done"
          : row.status === "NoShow"
            ? "no_show"
            : row.status === "LateCancelled"
              ? "late_cancel"
              : row.status === "Booked" || row.status === "Confirmed"
                ? "booked"
                : "none";
      if (status === "none") continue;
      const rank = { done: 3, booked: 2, no_show: 1, late_cancel: 1, none: 0 };
      const current = intros.get(contact.id);
      if (!current || rank[status] > rank[current.status]) {
        intros.set(contact.id, {
          status,
          at: row.start_datetime as string,
          trainerStaffId: row.staff_id as string | null,
        });
      }
    }
  }
  return intros;
}
