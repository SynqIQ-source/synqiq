import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { sha256 } from "@/lib/crm/kiosk-auth";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

// Publishes a new waiver version (requirement 2). Published versions are
// immutable (a DB trigger enforces it); this inserts version N+1 and moves
// the active flag to it. Everyone who signed an earlier version stays signed
// against that version.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request, 200_000);
    const raw = typeof body?.body === "string" ? body.body : "";
    // Normalize line endings and trim the ends only; otherwise the text is
    // stored exactly as pasted, since that's what guests sign.
    const text = raw.replace(/\r\n?/g, "\n").trim();
    if (text.length < 50 || text.length > 100_000) {
      return jsonError("Paste the full waiver text (at least 50 characters).", 400);
    }

    const admin = createSupabaseAdminClient();
    const { data: latest, error: latestError } = await admin
      .from("waiver_templates")
      .select("version, body_sha256, is_active")
      .eq("organization_id", staff.organizationId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    const hash = sha256(text);
    if (latest?.is_active && latest.body_sha256 === hash) {
      return jsonError("That's the same text as the current version.", 409);
    }

    const version = (latest?.version ?? 0) + 1;
    const { data: created, error: insertError } = await admin
      .from("waiver_templates")
      .insert({
        organization_id: staff.organizationId,
        version,
        body: text,
        body_sha256: hash,
        is_active: false,
        created_by_staff_id: staff.id,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    // A partial unique index allows one active version per org, so the old
    // one is switched off before the new one is switched on.
    const { error: deactivateError } = await admin
      .from("waiver_templates")
      .update({ is_active: false })
      .eq("organization_id", staff.organizationId)
      .eq("is_active", true);
    if (deactivateError) throw deactivateError;
    const { error: activateError } = await admin
      .from("waiver_templates")
      .update({ is_active: true })
      .eq("id", created.id)
      .eq("organization_id", staff.organizationId);
    if (activateError) throw activateError;

    return NextResponse.json({ success: true, version });
  } catch (error) {
    logCrmError("crm/waiver-templates POST", error);
    return jsonError("Couldn't publish the waiver.", 500);
  }
}
