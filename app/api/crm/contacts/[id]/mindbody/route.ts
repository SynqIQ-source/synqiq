import { NextResponse, after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError } from "@/lib/crm/http";
import { enqueueMindbodyPush, runJobById } from "@/lib/crm/jobs";

type RouteParams = { params: Promise<{ id: string }> };

// "Send to Mindbody" on a guest's profile: queues the push now (e.g. after
// staff added a field Mindbody required, or for a guest added before the
// push existed). Does nothing for a contact that's already linked.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Guest not found.", 404);

    const admin = createSupabaseAdminClient();
    const { data: contact, error } = await admin
      .from("crm_contacts")
      .select("id, mindbody_client_id, merged_into_id")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!contact || contact.merged_into_id) return jsonError("Guest not found.", 404);
    if (contact.mindbody_client_id) return jsonError("This guest is already linked to Mindbody.", 409);

    const { count, error: pendingError } = await admin
      .from("crm_jobs")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .eq("kind", "mindbody_push")
      .in("status", ["queued", "running"]);
    if (pendingError) throw pendingError;
    if ((count ?? 0) > 0) return jsonError("Already sending to Mindbody.", 409);

    const job = await enqueueMindbodyPush(admin, staff.organizationId, id);
    after(() => runJobById(job.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/contacts mindbody POST", error);
    return jsonError("Couldn't send to Mindbody.", 500);
  }
}
