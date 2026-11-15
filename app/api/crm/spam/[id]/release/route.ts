import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { saveWebLead, type LeadFormRow } from "@/lib/crm/web-lead-save";
import type { WebLead } from "@/lib/crm/web-leads";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admin: a website submission held as spam was a real person. Save it
// as a web lead exactly as the form would have.
export async function POST(_request: Request, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { data: held } = await admin
    .from("crm_spam_submissions")
    .select("id, organization_id, lead_form_id, fingerprint, lead, released_at")
    .eq("id", id)
    .eq("organization_id", staff.organizationId)
    .maybeSingle();
  if (!held) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  if (held.released_at) return NextResponse.json({ success: true });
  const { data: form } = held.lead_form_id
    ? await admin
        .from("crm_lead_forms")
        .select("id, organization_id, name, how_heard_label, assigned_staff_id, submission_count")
        .eq("id", held.lead_form_id)
        .maybeSingle()
    : { data: null };
  const formRow: LeadFormRow = (form as LeadFormRow | null) ?? {
    id: held.lead_form_id as string,
    organization_id: staff.organizationId,
    name: "Website",
    how_heard_label: null,
    assigned_staff_id: null,
    submission_count: 0,
  };
  try {
    const result = await saveWebLead(admin, formRow, held.lead as WebLead, held.fingerprint as string);
    await admin
      .from("crm_spam_submissions")
      .update({ released_at: new Date().toISOString(), released_by_staff_id: staff.id, released_contact_id: result.contactId })
      .eq("id", held.id);
    return NextResponse.json({ success: true, contactId: result.contactId });
  } catch (error) {
    console.error("[crm/spam] release failed:", error);
    return NextResponse.json({ success: false, error: "Couldn't add them. Try again." }, { status: 500 });
  }
}
