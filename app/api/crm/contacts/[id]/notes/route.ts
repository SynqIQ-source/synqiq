import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getContactViewerForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// Adds a note to a guest. Notes can't be edited or deleted (enforced in the
// database); a correction is a new note.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return jsonError("Guest not found.", 404);
    // CRM staff, or the trainer assigned to this member.
    const viewer = await getContactViewerForApi(id);
    if (!viewer) return jsonError("Not found.", 404);
    const { staff } = viewer;
    const body = await readJsonBody(request);
    const text = typeof body?.body === "string" ? body.body.replace(/\r\n?/g, "\n").trim() : "";
    if (!text) return jsonError("Write a note first.", 400);
    if (text.length > 5000) return jsonError("Notes can be up to 5,000 characters.", 400);

    const admin = createSupabaseAdminClient();
    const { data: contact, error } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!contact) return jsonError("Guest not found.", 404);

    const { error: insertError } = await admin.from("crm_notes").insert({
      organization_id: staff.organizationId,
      contact_id: id,
      author_staff_id: staff.id,
      body: text,
    });
    if (insertError) throw insertError;

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/notes POST", error);
    return jsonError("Couldn't save the note.", 500);
  }
}
