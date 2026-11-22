import * as XLSX from "xlsx";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import { planGymSalesImport, type GymSalesRow, type ImportContext, type ImportPlan } from "@/lib/crm/gymsales-import";

// Runs a Gym Sales People import: read the file (CSV or Excel), plan it
// against SynqIQ's staff, CRM guests and current members, then either
// preview (dry run) or apply it as one undoable batch.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export function readGymSalesFile(bytes: Uint8Array): GymSalesRow[] {
  // raw: keep every cell as text (phones and ids must not become numbers).
  const book = XLSX.read(bytes, { type: "array", raw: true, cellDates: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json<GymSalesRow>(sheet, { defval: "", raw: false });
}

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function loadImportContext(admin: Admin, organizationId: string): Promise<ImportContext> {
  const [staff, contacts, contracts, clients, personal] = await Promise.all([
    admin.from("staff").select("id, display_name").eq("organization_id", organizationId).is("archived_at", null),
    all((a, b) =>
      admin
        .from("crm_contacts")
        .select("id, first_name, email_normalized, phone_e164")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .is("merged_into_id", null)
        .order("id")
        .range(a, b),
    ),
    // Current members: anyone with an active autopay contract.
    all((a, b) =>
      admin
        .from("member_contracts")
        .select("mindbody_client_id")
        .eq("organization_id", organizationId)
        .eq("autopay_status", "Active")
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("clients")
        .select("mindbody_client_id, email")
        .eq("organization_id", organizationId)
        .not("email", "is", null)
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("member_personal")
        .select("mindbody_client_id, mindbody")
        .eq("organization_id", organizationId)
        .order("mindbody_client_id")
        .range(a, b),
    ),
  ]);
  const members = new Set(contracts.map((row) => row.mindbody_client_id as string));
  const staffByName = new Map((staff.data ?? []).map((row) => [String(row.display_name ?? "").toLowerCase(), row.id as string]));
  const existingByEmail = new Map<string, string>();
  const existingByPhone = new Map<string, string>();
  for (const row of contacts) {
    const first = String(row.first_name ?? "")
      .trim()
      .toLowerCase();
    if (row.email_normalized) existingByEmail.set(`${first}|${row.email_normalized}`, row.id as string);
    if (row.phone_e164) existingByPhone.set(`${first}|${row.phone_e164}`, row.id as string);
  }
  const memberByEmail = new Map<string, string>();
  for (const row of clients) {
    const email = normalizeEmail(row.email);
    if (email && members.has(row.mindbody_client_id as string)) memberByEmail.set(email, row.mindbody_client_id as string);
  }
  const memberByPhone = new Map<string, string>();
  for (const row of personal) {
    const id = row.mindbody_client_id as string;
    if (!members.has(id)) continue;
    const info = (row.mindbody ?? {}) as { mobilePhone?: string | null; homePhone?: string | null; email?: string | null };
    for (const raw of [info.mobilePhone, info.homePhone]) {
      const phone = raw ? normalizePhone(raw) : null;
      if (phone && !memberByPhone.has(phone)) memberByPhone.set(phone, id);
    }
    const email = normalizeEmail(info.email);
    if (email && !memberByEmail.has(email)) memberByEmail.set(email, id);
  }
  return { staffByName, existingByEmail, existingByPhone, memberByEmail, memberByPhone };
}

export async function planFromFile(admin: Admin, organizationId: string, bytes: Uint8Array): Promise<ImportPlan> {
  return planGymSalesImport(readGymSalesFile(bytes), await loadImportContext(admin, organizationId));
}

// Applies a plan as one batch. New guests are created; guests already in the
// CRM only get blanks filled and the Gym Sales link (staff edits are kept).
export async function applyPlan(admin: Admin, organizationId: string, plan: ImportPlan, filename: string, staffId: string | null) {
  const { data: batch, error } = await admin
    .from("crm_import_batches")
    .insert({ organization_id: organizationId, source: "gymsales", filename, summary: plan.stats, created_by_staff_id: staffId })
    .select("id")
    .single();
  if (error || !batch) throw new Error(error?.message ?? "Couldn't start the import.");
  const now = new Date().toISOString();
  const creates = plan.contacts.filter((c) => !c.existingId);
  for (let i = 0; i < creates.length; i += 500) {
    const part = creates.slice(i, i + 500).map((c) => ({
      organization_id: organizationId,
      first_name: c.firstName,
      last_name: c.lastName,
      email: c.email,
      email_normalized: c.email,
      phone_e164: c.phone,
      address_line1: c.address,
      city: c.city,
      state: c.state,
      postal_code: c.postalCode,
      date_of_birth: c.dateOfBirth,
      status: c.status,
      source: c.source,
      how_heard: c.howHeard,
      assigned_staff_id: c.assignedStaffId,
      mindbody_client_id: c.mindbodyClientId,
      mindbody_sync_status: c.mindbodyClientId ? "synced" : "not_synced",
      // Linked only when they're already an Active member: never a sales close.
      mindbody_member_at_link: Boolean(c.mindbodyClientId),
      email_consent: c.emailConsent,
      email_consent_at: c.emailConsent ? (c.createdAt ?? now) : null,
      sms_consent: c.smsConsent,
      sms_consent_at: c.smsConsent ? (c.createdAt ?? now) : null,
      sms_opted_out_at: c.smsOptedOutAt,
      email_check_status: "skipped",
      not_interested_at: c.notInterestedAt,
      created_at: c.createdAt ?? now,
      updated_at: now,
      created_by_staff_id: staffId,
      import_batch_id: batch.id,
      external_ref: c.externalRef,
      import_data: c.importData,
    }));
    const { error: insertError } = await admin.from("crm_contacts").insert(part);
    if (insertError) throw new Error(`Rows ${i + 1}-${i + part.length}: ${insertError.message}`);
  }
  let linked = 0;
  for (const c of plan.contacts.filter((x) => x.existingId)) {
    const { data: current } = await admin
      .from("crm_contacts")
      .select("email, phone_e164, assigned_staff_id, external_ref, import_data")
      .eq("id", c.existingId as string)
      .maybeSingle();
    if (!current) continue;
    const updates: Record<string, unknown> = {
      external_ref: current.external_ref ?? c.externalRef,
      import_data: current.import_data ?? c.importData,
    };
    if (!current.email && c.email) Object.assign(updates, { email: c.email, email_normalized: c.email });
    if (!current.phone_e164 && c.phone) updates.phone_e164 = c.phone;
    if (!current.assigned_staff_id && c.assignedStaffId) updates.assigned_staff_id = c.assignedStaffId;
    await admin
      .from("crm_contacts")
      .update(updates)
      .eq("id", c.existingId as string);
    linked += 1;
  }
  return { batchId: batch.id as string, created: creates.length, linked };
}

// Undo: removes (soft-deletes) the guests a batch created. Guests that were
// already in the CRM keep their own data.
export async function undoBatch(admin: Admin, organizationId: string, batchId: string, staffId: string | null) {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("crm_contacts")
    .update({ deleted_at: now, deleted_by_staff_id: staffId })
    .eq("organization_id", organizationId)
    .eq("import_batch_id", batchId)
    .is("deleted_at", null)
    .select("id");
  await admin
    .from("crm_import_batches")
    .update({ undone_at: now, undone_by_staff_id: staffId })
    .eq("id", batchId)
    .eq("organization_id", organizationId);
  return { removed: data?.length ?? 0 };
}
