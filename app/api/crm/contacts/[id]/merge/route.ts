import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { MergeError, mergeContacts } from "@/lib/crm/merge";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Admin "Merge into…" on a guest's profile: folds this guest into another
// one the admin picked (for duplicates the kiosk didn't catch).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    const body = await readJsonBody(request);
    if (!isUuid(id) || !isUuid(body?.intoId)) return jsonError("Pick the guest to merge into.", 400);

    const admin = createSupabaseAdminClient();
    await mergeContacts(admin, staff.organizationId, staff.id, id, body.intoId as string);
    return NextResponse.json({ success: true, contactId: body.intoId });
  } catch (error) {
    if (error instanceof MergeError) return jsonError(error.message, error.status);
    logCrmError("crm/contacts merge POST", error);
    return jsonError("Couldn't merge these guests.", 500);
  }
}
