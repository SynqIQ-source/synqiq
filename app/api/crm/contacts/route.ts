import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { cleanText, normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { enqueueEmailCheck, runJobById } from "@/lib/crm/jobs";

const SOURCES = ["phone_in", "walk_in", "guest_of_member", "other"] as const;

// "Add lead" on the Guests page: a lead a staff member enters by hand (a
// phone-in, for example). The staff member who enters it is the seller.
// Duplicates are checked against this org's own CRM contacts; a match comes
// back as a 409 the form shows, and the staff member can open the existing
// contact or create the lead anyway (flagged as a possible duplicate).
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const firstName = cleanText(body?.firstName, 60);
    const lastName = cleanText(body?.lastName, 60);
    const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
    const phoneRaw = typeof body?.phone === "string" ? body.phone.trim() : "";
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const source = SOURCES.find((value) => value === body?.source) ?? null;
    const howHeard = Array.isArray(body?.howHeard) ? body.howHeard : [];

    if (!firstName || !lastName) return jsonError("Enter a first and last name.", 400);
    if (emailRaw && !email) return jsonError("That email address doesn't look right.", 400);
    if (phoneRaw && !phone) return jsonError("That phone number doesn't look right.", 400);
    if (!email && !phone) return jsonError("Enter an email address or a phone number.", 400);
    if (!source) return jsonError("Pick a lead source.", 400);
    if (howHeard.length > 20 || howHeard.some((value: unknown) => typeof value !== "string")) {
      return jsonError("Invalid 'how did you hear' selection.", 400);
    }

    const admin = createSupabaseAdminClient();

    if (howHeard.length > 0) {
      const { data: sources, error } = await admin
        .from("crm_marketing_sources")
        .select("label")
        .eq("organization_id", staff.organizationId);
      if (error) throw error;
      const labels = new Set((sources ?? []).map((row) => row.label));
      if (howHeard.some((label: string) => !labels.has(label))) {
        return jsonError("Invalid 'how did you hear' selection.", 400);
      }
    }

    const filters = [email ? `email_normalized.eq.${email}` : null, phone ? `phone_e164.eq.${phone}` : null].filter(
      Boolean,
    );
    const { data: existing, error: matchError } = await admin
      .from("crm_contacts")
      .select("id, first_name, last_name")
      .eq("organization_id", staff.organizationId)
      .is("merged_into_id", null)
      .is("deleted_at", null)
      .or(filters.join(","))
      .order("created_at", { ascending: true })
      .limit(1);
    if (matchError) throw matchError;
    const duplicate = existing?.[0] ?? null;

    if (duplicate && body?.allowDuplicate !== true) {
      return NextResponse.json(
        {
          success: false,
          error: "A contact with this email or phone already exists.",
          duplicate: { id: duplicate.id, name: `${duplicate.first_name} ${duplicate.last_name}` },
        },
        { status: 409 },
      );
    }

    const { data: created, error } = await admin
      .from("crm_contacts")
      .insert({
        organization_id: staff.organizationId,
        first_name: firstName,
        last_name: lastName,
        email,
        email_normalized: email,
        phone_e164: phone,
        status: "lead",
        source,
        how_heard: [...new Set(howHeard as string[])],
        assigned_staff_id: staff.id,
        created_by_staff_id: staff.id,
        possible_duplicate_of: duplicate?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    if (duplicate && isUuid(duplicate.id)) {
      const { error: pendingError } = await admin.from("crm_pending_matches").insert({
        organization_id: staff.organizationId,
        submitted_contact_id: created.id,
        candidate_contact_id: duplicate.id,
        reason: "partial_match",
      });
      if (pendingError) throw pendingError;
    }

    if (email) {
      const jobId = await enqueueEmailCheck(admin, staff.organizationId, created.id);
      after(() => runJobById(jobId));
    } else {
      await admin
        .from("crm_contacts")
        .update({ email_check_status: "skipped" })
        .eq("id", created.id)
        .eq("organization_id", staff.organizationId);
    }

    return NextResponse.json({ success: true, id: created.id });
  } catch (error) {
    logCrmError("crm/contacts POST", error);
    return jsonError("Couldn't add the lead.", 500);
  }
}
