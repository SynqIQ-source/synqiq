import type { SupabaseClient } from "@supabase/supabase-js";

// Fields copied onto the kept contact on merge, only where it has none.
const FILL_FIELDS = [
  "date_of_birth",
  "email",
  "email_normalized",
  "phone_e164",
  "address_line1",
  "city",
  "state",
  "postal_code",
  "photo_path",
  "referring_client_id",
  "referrer_name_typed",
  "assigned_staff_id",
  "mindbody_client_id",
] as const;

export class MergeError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

// Folds `fromId` into `intoId` (admins only -- callers check): its visits
// move over, empty fields on the kept contact are filled in, and it's marked
// merged_into (contacts are never deleted). Open duplicate items involving
// the merged-away contact are closed.
export async function mergeContacts(
  admin: SupabaseClient,
  organizationId: string,
  staffId: string,
  fromId: string,
  intoId: string,
) {
  if (fromId === intoId) throw new MergeError("Pick a different guest to merge into.", 400);

  const columns = ["id", "merged_into_id", "deleted_at", ...FILL_FIELDS].join(", ");
  const { data, error } = await admin
    .from("crm_contacts")
    .select(columns)
    .eq("organization_id", organizationId)
    .in("id", [fromId, intoId]);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, string | null>[];
  const from = rows.find((row) => row.id === fromId);
  const into = rows.find((row) => row.id === intoId);
  if (!from || !into) throw new MergeError("Guest not found.", 404);
  if (from.merged_into_id || into.merged_into_id) throw new MergeError("One of these guests was already merged.");
  if (into.deleted_at) throw new MergeError("Can't merge into a deleted guest.");
  if (from.mindbody_client_id && into.mindbody_client_id && from.mindbody_client_id !== into.mindbody_client_id) {
    throw new MergeError("These guests are linked to two different Mindbody clients; merge them in Mindbody first.");
  }

  const fill: Record<string, string> = {};
  for (const field of FILL_FIELDS) {
    const value = from[field];
    if (!into[field] && value) fill[field] = value;
  }
  // Email is stored as a pair (display + normalized); copy both or neither.
  if (Boolean(fill.email) !== Boolean(fill.email_normalized)) {
    delete fill.email;
    delete fill.email_normalized;
  }
  if (fill.mindbody_client_id) Object.assign(fill, { mindbody_sync_status: "synced" });

  const now = new Date().toISOString();
  const { error: intoError } = await admin
    .from("crm_contacts")
    .update({ ...fill, updated_at: now })
    .eq("id", intoId)
    .eq("organization_id", organizationId);
  if (intoError) throw intoError;

  // Visits move over. Notes, like waivers, can't be changed, so they stay on
  // the merged record and the profile shows them from both.
  const { error: visitsError } = await admin
    .from("guest_visits")
    .update({ contact_id: intoId })
    .eq("contact_id", fromId)
    .eq("organization_id", organizationId);
  if (visitsError) throw visitsError;

  const { error: fromError } = await admin
    .from("crm_contacts")
    .update({ merged_into_id: intoId, possible_duplicate_of: null, updated_at: now })
    .eq("id", fromId)
    .eq("organization_id", organizationId);
  if (fromError) throw fromError;

  await admin
    .from("crm_pending_matches")
    .update({ status: "merged", resolved_by_staff_id: staffId, resolved_at: now })
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .or(`submitted_contact_id.eq.${fromId},candidate_contact_id.eq.${fromId}`);
}
