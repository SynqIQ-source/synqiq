import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { MergeError, mergeContacts } from "@/lib/crm/merge";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Resolves a possible-duplicate item from the Guests page:
//   merge (admins only) -- the new contact folds into the existing one (see
//                          lib/crm/merge.ts)
//   keep_separate       -- they're different people; both stay as they are
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
    if (action === "merge" && staff.role !== "admin") {
      return jsonError("Only admins can merge guests.", 403);
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
      await mergeContacts(admin, staff.organizationId, staff.id, match.submitted_contact_id, match.candidate_contact_id);
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

    return NextResponse.json({ success: true, contactId: action === "merge" ? match.candidate_contact_id : null });
  } catch (error) {
    if (error instanceof MergeError) return jsonError(error.message, error.status);
    logCrmError("crm/pending-matches POST", error);
    return jsonError("Couldn't resolve the match.", 500);
  }
}
