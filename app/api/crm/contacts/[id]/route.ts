import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { cleanDateOfBirth, cleanState, cleanText, cleanZip, normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { enqueueEmailCheck, enqueueMindbodyPush, runJobById } from "@/lib/crm/jobs";

type RouteParams = { params: Promise<{ id: string }> };

// Edits a guest from their profile.
//   details (admins and sellers): name, email, phone, birth date, address.
//     A changed email is re-checked (and the contact re-sent to Mindbody if
//     it isn't linked yet); other changes re-send a contact whose Mindbody
//     push failed. Edits aren't pushed to an already-linked Mindbody client.
//   assignedStaffId (admins only): assign or reassign the salesperson, or
//     null to unassign.
// Only keys present in the body are changed.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Guest not found.", 404);
    const body = await readJsonBody(request);
    if (!body) return jsonError("Invalid request.", 400);

    const admin = createSupabaseAdminClient();
    const { data: contact, error } = await admin
      .from("crm_contacts")
      .select("id, email_normalized, phone_e164, mindbody_client_id, mindbody_sync_status, merged_into_id")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!contact || contact.merged_into_id) return jsonError("Guest not found.", 404);

    const updates: Record<string, unknown> = {};
    const text = (key: string, max: number, label: string, required = false) => {
      if (!(key in body)) return;
      const raw = typeof body[key] === "string" ? (body[key] as string).trim() : "";
      if (!raw) {
        if (required) throw new Error(`${label} can't be empty.`);
        return null;
      }
      const value = cleanText(raw, max);
      if (!value) throw new Error(`${label} is too long.`);
      return value;
    };

    try {
      const firstName = text("firstName", 60, "First name", true);
      if (firstName !== undefined) updates.first_name = firstName;
      const lastName = text("lastName", 60, "Last name", true);
      if (lastName !== undefined) updates.last_name = lastName;

      if ("email" in body) {
        const raw = typeof body.email === "string" ? body.email.trim() : "";
        const email = raw ? normalizeEmail(raw) : null;
        if (raw && !email) throw new Error("That email address doesn't look right.");
        updates.email = email;
        updates.email_normalized = email;
      }
      if ("phone" in body) {
        const raw = typeof body.phone === "string" ? body.phone.trim() : "";
        const phone = raw ? normalizePhone(raw) : null;
        if (raw && !phone) throw new Error("That phone number doesn't look right.");
        updates.phone_e164 = phone;
      }
      if ("dateOfBirth" in body) {
        const raw = typeof body.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
        const dob = raw ? cleanDateOfBirth(raw) : null;
        if (raw && !dob) throw new Error("That date of birth doesn't look right.");
        updates.date_of_birth = dob;
      }
      const street = text("addressLine1", 120, "Street address");
      if (street !== undefined) updates.address_line1 = street;
      const city = text("city", 60, "City");
      if (city !== undefined) updates.city = city;
      if ("state" in body) {
        const raw = typeof body.state === "string" ? body.state.trim() : "";
        const state = raw ? cleanState(raw) : null;
        if (raw && !state) throw new Error("Use the 2-letter state code, like TX.");
        updates.state = state;
      }
      if ("postalCode" in body) {
        const raw = typeof body.postalCode === "string" ? body.postalCode.trim() : "";
        const zip = raw ? cleanZip(raw) : null;
        if (raw && !zip) throw new Error("ZIP code should be 5 digits.");
        updates.postal_code = zip;
      }
    } catch (validation) {
      return jsonError(validation instanceof Error ? validation.message : "Invalid details.", 400);
    }

    const emailAfter = "email_normalized" in updates ? updates.email_normalized : contact.email_normalized;
    const phoneAfter = "phone_e164" in updates ? updates.phone_e164 : contact.phone_e164;
    if (!emailAfter && !phoneAfter) return jsonError("Keep at least an email address or a phone number.", 400);

    if ("assignedStaffId" in body) {
      if (staff.role !== "admin") return jsonError("Only admins can assign a salesperson.", 403);
      const assigned = body.assignedStaffId;
      if (assigned === null || assigned === "") {
        updates.assigned_staff_id = null;
      } else {
        if (!isUuid(assigned)) return jsonError("Pick a salesperson from the list.", 400);
        const { data: seller, error: sellerError } = await admin
          .from("staff")
          .select("id")
          .eq("id", assigned)
          .eq("organization_id", staff.organizationId)
          .is("archived_at", null)
          .maybeSingle();
        if (sellerError) throw sellerError;
        if (!seller) return jsonError("Pick a salesperson from the list.", 400);
        updates.assigned_staff_id = seller.id;
      }
    }

    if (Object.keys(updates).length === 0) return NextResponse.json({ success: true });

    const emailChanged = "email_normalized" in updates && updates.email_normalized !== contact.email_normalized;
    if (emailChanged) {
      updates.email_check_status = updates.email_normalized ? "pending" : "skipped";
      updates.email_check_result = null;
      updates.email_checked_at = null;
    }

    const { error: updateError } = await admin
      .from("crm_contacts")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", staff.organizationId);
    if (updateError) throw updateError;

    const detailsChanged = Object.keys(updates).some((key) => key !== "assigned_staff_id");
    if (emailChanged && updates.email_normalized) {
      // The check queues the Mindbody push when it finishes.
      const jobId = await enqueueEmailCheck(admin, staff.organizationId, id);
      after(() => runJobById(jobId));
    } else if (detailsChanged && !contact.mindbody_client_id && contact.mindbody_sync_status === "failed") {
      const job = await enqueueMindbodyPush(admin, staff.organizationId, id);
      after(() => runJobById(job.id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/contacts PATCH", error);
    return jsonError("Couldn't save the changes.", 500);
  }
}
