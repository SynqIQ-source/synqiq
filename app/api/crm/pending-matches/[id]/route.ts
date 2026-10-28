import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

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
] as const;

// Staff resolve a pending match from the Guests page:
//   merge         -- the submitted contact folds into the existing one: its
//                    visits move over, empty fields are filled in, and it's
//                    marked merged_into (contacts are never deleted). Signed
//                    waivers can't be changed, so they stay on the merged
//                    record and the profile page shows them from both.
//   keep_separate -- they're different people; both stay as they are.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    const body = await readJsonBody(request);
    const action = body?.action;
    if (!isUuid(id) || (action !== "merge" && action !== "keep_separate")) {
      return jsonError("Invalid request.", 400);
    }

    const admin = createSupabaseAdminClient();
    const { data: match, error } = await admin
      .from("crm_pending_matches")
      .select("id, status, submitted_contact_id, candidate_contact_id")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!match) return jsonError("Match not found.", 404);
    if (match.status !== "open") return jsonError("This match was already resolved.", 409);

    const now = new Date().toISOString();

    if (action === "merge") {
      const columns = ["id", "merged_into_id", ...FILL_FIELDS].join(", ");
      const { data: contacts, error: contactsError } = await admin
        .from("crm_contacts")
        .select(columns)
        .eq("organization_id", staff.organizationId)
        .in("id", [match.submitted_contact_id, match.candidate_contact_id]);
      if (contactsError) throw contactsError;
      const rows = (contacts ?? []) as unknown as Record<string, string | null>[];
      const submitted = rows.find((row) => row.id === match.submitted_contact_id);
      const kept = rows.find((row) => row.id === match.candidate_contact_id);
      if (!submitted || !kept) return jsonError("Contact not found.", 404);
      if (submitted.merged_into_id || kept.merged_into_id) {
        return jsonError("One of these contacts was already merged.", 409);
      }

      const fill: Record<string, string> = {};
      for (const field of FILL_FIELDS) {
        const value = submitted[field];
        if (!kept[field] && value) fill[field] = value;
      }
      // Email and phone are normalized as a pair with their match columns.
      if (fill.email && !fill.email_normalized) delete fill.email;

      const { error: keptError } = await admin
        .from("crm_contacts")
        .update({ ...fill, updated_at: now })
        .eq("id", kept.id!)
        .eq("organization_id", staff.organizationId);
      if (keptError) throw keptError;

      const { error: visitsError } = await admin
        .from("guest_visits")
        .update({ contact_id: kept.id })
        .eq("contact_id", submitted.id!)
        .eq("organization_id", staff.organizationId);
      if (visitsError) throw visitsError;

      const { error: mergedError } = await admin
        .from("crm_contacts")
        .update({ merged_into_id: kept.id, updated_at: now })
        .eq("id", submitted.id!)
        .eq("organization_id", staff.organizationId);
      if (mergedError) throw mergedError;
    } else {
      const { error: clearError } = await admin
        .from("crm_contacts")
        .update({ possible_duplicate_of: null, updated_at: now })
        .eq("id", match.submitted_contact_id)
        .eq("organization_id", staff.organizationId);
      if (clearError) throw clearError;
    }

    const { error: resolveError } = await admin
      .from("crm_pending_matches")
      .update({
        status: action === "merge" ? "merged" : "kept_separate",
        resolved_by_staff_id: staff.id,
        resolved_at: now,
      })
      .eq("id", match.id)
      .eq("organization_id", staff.organizationId);
    if (resolveError) throw resolveError;

    // Any other open items about the merged-away contact are moot now.
    if (action === "merge") {
      await admin
        .from("crm_pending_matches")
        .update({ status: "merged", resolved_by_staff_id: staff.id, resolved_at: now })
        .eq("organization_id", staff.organizationId)
        .eq("status", "open")
        .eq("submitted_contact_id", match.submitted_contact_id);
    }

    return NextResponse.json({ success: true, contactId: action === "merge" ? match.candidate_contact_id : null });
  } catch (error) {
    logCrmError("crm/pending-matches POST", error);
    return jsonError("Couldn't resolve the match.", 500);
  }
}
