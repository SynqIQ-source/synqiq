import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Settings -> Mindbody items (admins): tick or untick one contract
// ("counts as a membership") or item sold ("is PT") for the admin's studio.
export async function PATCH(request: NextRequest) {
  try {
    const staff = await getCurrentStaff();
    if (!staff || staff.role !== "admin") return jsonError("Not found.", 404);
    const body = await readJsonBody(request);
    const kind = body?.kind;
    const name = typeof body?.name === "string" ? body.name : "";
    if ((kind !== "contract" && kind !== "sale_item") || !name || typeof body?.counts !== "boolean") {
      return jsonError("Invalid request.", 400);
    }
    // Only names Synq has already seen for this studio can be set.
    const { data, error } = await createSupabaseAdminClient()
      .from("mindbody_item_types")
      .update({ counts: body.counts, updated_by_staff_id: staff.id })
      .eq("organization_id", staff.organizationId)
      .eq("kind", kind)
      .eq("name", name)
      .select("id");
    if (error) throw error;
    if (!data?.length) return jsonError("That item isn't on the list.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("settings/mindbody-items PATCH", error);
    return jsonError("Couldn't save that change.", 500);
  }
}
