import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientIp, getKioskDevice, sha256, type KioskDevice } from "@/lib/crm/kiosk-auth";
import { findContactMatch, resolveReferringMember } from "@/lib/crm/matching";
import {
  cleanDateOfBirth,
  cleanState,
  cleanText,
  cleanZip,
  formatPhoneForDisplay,
  isMinor,
  normalizeEmail,
  normalizePhone,
  sameName,
} from "@/lib/crm/normalize";
import { getCrmOrg, type CrmOrg } from "@/lib/crm/org";
import { decodeJpeg, decodePng } from "@/lib/crm/images";
import { buildWaiverPdf } from "@/lib/crm/waiver-pdf";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { enqueueEmailCheck, runJobById } from "@/lib/crm/jobs";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

const BUCKET = "crm-private";

// A validation failure the guest can fix; the message is shown on the kiosk.
class CheckInError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Details = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

type ContactForWaiver = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  email: string | null;
  phone_e164: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

function parseDetails(raw: unknown): Details {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const details = {
    firstName: cleanText(input.firstName, 60),
    lastName: cleanText(input.lastName, 60),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    dateOfBirth: cleanDateOfBirth(input.dateOfBirth),
    addressLine1: cleanText(input.addressLine1, 120),
    city: cleanText(input.city, 60),
    state: cleanState(input.state),
    postalCode: cleanZip(input.postalCode),
  };
  const missing = Object.entries(details).find(([, value]) => !value);
  if (missing) {
    throw new CheckInError("Some details are missing or invalid. Go back and check them.");
  }
  return details as Details;
}

// Only birth date + address, for a returning contact whose record lacks them.
function parseMissingDetails(raw: unknown) {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const details = {
    date_of_birth: cleanDateOfBirth(input.dateOfBirth),
    address_line1: cleanText(input.addressLine1, 120),
    city: cleanText(input.city, 60),
    state: cleanState(input.state),
    postal_code: cleanZip(input.postalCode),
  };
  if (Object.values(details).some((value) => !value)) {
    throw new CheckInError("Some details are missing or invalid. Go back and check them.");
  }
  return details as Record<keyof typeof details, string>;
}

async function validSellerId(admin: SupabaseClient, organizationId: string, raw: unknown): Promise<string | null> {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!isUuid(raw)) throw new CheckInError("Pick someone from the list, or leave it blank.");
  const { data, error } = await admin
    .from("staff")
    .select("id")
    .eq("id", raw)
    .eq("organization_id", organizationId)
    .eq("can_sell", true)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CheckInError("Pick someone from the list, or leave it blank.");
  return data.id;
}

async function validHowHeard(admin: SupabaseClient, organizationId: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length > 20 || raw.some((value) => typeof value !== "string")) {
    throw new CheckInError("Pick how you heard about us.");
  }
  if (raw.length === 0) return [];
  const { data, error } = await admin
    .from("crm_marketing_sources")
    .select("label")
    .eq("organization_id", organizationId)
    .eq("active", true);
  if (error) throw error;
  const labels = new Set((data ?? []).map((row) => row.label));
  const picked = [...new Set(raw as string[])];
  if (picked.some((label) => !labels.has(label))) {
    throw new CheckInError("Pick how you heard about us from the list.");
  }
  return picked;
}

async function upload(admin: SupabaseClient, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

// "Is this you?" tokens are one-time: same org, same device, unused and
// unexpired. The check-in peeks first (so a typo in the waiver step doesn't
// burn the token) and consumes it atomically right before writing rows, so
// it can't be replayed.
async function matchTokenContact(
  admin: SupabaseClient,
  device: KioskDevice,
  raw: unknown,
  mode: "peek" | "consume",
): Promise<string | null> {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 100) return null;
  const nowIso = new Date().toISOString();
  const base =
    mode === "consume"
      ? admin.from("kiosk_match_tokens").update({ used_at: nowIso })
      : admin.from("kiosk_match_tokens").select("contact_id");
  const { data, error } = await base
    .eq("token_hash", sha256(raw))
    .eq("organization_id", device.organizationId)
    .eq("kiosk_device_id", device.deviceId)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("contact_id");
  if (error) throw error;
  return data && data.length === 1 ? data[0].contact_id : null;
}

// Validates the waiver step, renders the PDF and stores the images + PDF.
// Returns the row to insert into waiver_signatures (not inserted here, so
// the caller can insert it after the contact and visit exist).
async function prepareWaiver(
  admin: SupabaseClient,
  request: NextRequest,
  device: KioskDevice,
  org: CrmOrg,
  contact: ContactForWaiver,
  visitId: string,
  raw: unknown,
) {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const { data: template, error: templateError } = await admin
    .from("waiver_templates")
    .select("id, version, body, body_sha256")
    .eq("organization_id", device.organizationId)
    .eq("is_active", true)
    .maybeSingle();
  if (templateError) throw templateError;
  if (!template) throw new CheckInError("The waiver isn't available right now. Please see the front desk.", 409);
  // The guest must have signed the version that is active right now; if an
  // admin published a new one mid-check-in, the kiosk reloads it.
  if (input.templateId !== template.id) {
    throw new CheckInError("The waiver was just updated. Please read the new version and sign again.", 409);
  }

  const fullName = `${contact.first_name} ${contact.last_name}`;
  const minor = isMinor(contact.date_of_birth, org.timezone);
  const guardianName = minor ? cleanText(input.guardianName, 120) : null;
  const typedName = cleanText(input.typedName, 120);
  const signaturePng = decodePng(input.signature);
  const guardianSignaturePng = minor ? decodePng(input.guardianSignature) : null;

  if (input.agreed !== true) throw new CheckInError("Tick the box to agree to the waiver.");
  if (!signaturePng) throw new CheckInError("Please sign in the box.");
  if (!typedName || !(sameName(typedName, fullName) || (guardianName && sameName(typedName, guardianName)))) {
    throw new CheckInError("Type your full name exactly as entered.");
  }
  if (minor && (!guardianName || !guardianSignaturePng)) {
    throw new CheckInError("Guests under 18 need a parent or guardian's name and signature.");
  }

  const signatureId = randomUUID();
  const folder = `${device.organizationId}/waivers/${signatureId}`;
  const signedAt = DateTime.utc();
  const ip = clientIp(request.headers);
  const userAgent = request.headers.get("user-agent")?.slice(0, 400) ?? null;
  const address = [contact.address_line1, contact.city, [contact.state, contact.postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const pdf = await buildWaiverPdf({
    organizationName: org.name,
    templateVersion: template.version,
    templateSha256: template.body_sha256,
    waiverText: template.body,
    signer: {
      fullName,
      typedName,
      dateOfBirth: DateTime.fromISO(contact.date_of_birth).toFormat("LLL d, yyyy"),
      email: contact.email,
      phone: formatPhoneForDisplay(contact.phone_e164) || null,
      address: address || null,
    },
    isMinor: minor,
    guardianName,
    signaturePng,
    guardianSignaturePng,
    signedAtLocal: signedAt.setZone(org.timezone).toFormat("LLL d, yyyy, h:mm:ss a ZZZZ"),
    signedAtUtc: signedAt.toISO({ suppressMilliseconds: true }) ?? signedAt.toISO()!,
    ip,
    userAgent,
    signatureId,
  });

  await upload(admin, `${folder}/signature.png`, signaturePng, "image/png");
  if (guardianSignaturePng) {
    await upload(admin, `${folder}/guardian-signature.png`, guardianSignaturePng, "image/png");
  }
  await upload(admin, `${folder}/waiver.pdf`, pdf, "application/pdf");

  return {
    id: signatureId,
    organization_id: device.organizationId,
    contact_id: contact.id,
    visit_id: visitId,
    template_id: template.id,
    template_version: template.version,
    template_sha256: template.body_sha256,
    signed_at: signedAt.toISO(),
    signer_ip: ip,
    signer_user_agent: userAgent,
    typed_name: typedName,
    agreed: true,
    is_minor: minor,
    guardian_name: guardianName,
    signature_path: `${folder}/signature.png`,
    guardian_signature_path: guardianSignaturePng ? `${folder}/guardian-signature.png` : null,
    pdf_path: `${folder}/waiver.pdf`,
    pdf_sha256: sha256(pdf),
    kiosk_device_id: device.deviceId,
  };
}

// The whole kiosk check-in in one request (requirement 5). The organization
// always comes from the paired device; nothing in the body can choose it.
// This route only ever creates rows -- it returns nothing about anyone.
export async function POST(request: NextRequest) {
  try {
    const device = await getKioskDevice();
    if (!device) return jsonError("This kiosk isn't paired.", 401);

    const allowed = await rateLimitAll([
      { key: `kiosk-checkin:device:${device.deviceId}`, windowSeconds: 600, limit: 20 },
      { key: `kiosk-checkin:device-day:${device.deviceId}`, windowSeconds: 86_400, limit: 200 },
    ]);
    if (!allowed) return jsonError("Please see the front desk to finish checking in.", 429);

    const body = await readJsonBody(request, 3_500_000);
    if (!body) return jsonError("Something went wrong. Please start again.", 400);

    const admin = createSupabaseAdminClient();
    const org = await getCrmOrg(device.organizationId);

    const visitReason = body.visitReason;
    if (visitReason !== "membership" && visitReason !== "guest_of_member") {
      throw new CheckInError("Choose what brings you in today.");
    }
    const visitType = visitReason === "membership" ? "walk_in" : "guest_visit";
    const sellerId = await validSellerId(admin, device.organizationId, body.sellerId);
    const visitId = randomUUID();
    const now = new Date().toISOString();

    // --- Returning guest who tapped "Yes, that's me" ----------------------
    if (body.matchToken !== undefined) {
      const contactId = await matchTokenContact(admin, device, body.matchToken, "peek");
      if (!contactId) {
        throw new CheckInError("This check-in timed out. Please start again.", 409);
      }

      const { data: existing, error: contactError } = await admin
        .from("crm_contacts")
        .select("id, first_name, last_name, date_of_birth, email, phone_e164, address_line1, city, state, postal_code, assigned_staff_id")
        .eq("organization_id", device.organizationId)
        .eq("id", contactId)
        .single();
      if (contactError) throw contactError;

      // Fill in birth date/address only where the record has none (a phone-in
      // lead); never overwrite what staff already have.
      const updates: Record<string, string> = {};
      if (!existing.date_of_birth || !existing.address_line1 || !existing.city || !existing.state || !existing.postal_code) {
        const missing = parseMissingDetails(body.details);
        for (const [key, value] of Object.entries(missing)) {
          if (!existing[key as keyof typeof existing]) updates[key] = value;
        }
      }
      // A returning guest goes to whoever they said they're meeting, else to
      // the salesperson on duty on this iPad (if one is set).
      const { data: kiosk } = await admin
        .from("kiosk_devices")
        .select("on_duty_staff_id")
        .eq("id", device.deviceId)
        .single();
      const newOwner = sellerId ?? kiosk?.on_duty_staff_id ?? null;
      const previousOwner = existing.assigned_staff_id as string | null;
      if (newOwner && newOwner !== previousOwner) updates.assigned_staff_id = newOwner;
      const contact = { ...existing, ...updates } as ContactForWaiver & { assigned_staff_id: string | null };

      const { count, error: countError } = await admin
        .from("waiver_signatures")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", device.organizationId)
        .eq("contact_id", contact.id);
      if (countError) throw countError;
      const signature =
        (count ?? 0) === 0
          ? await prepareWaiver(admin, request, device, org, contact, visitId, body.waiver)
          : null;

      if ((await matchTokenContact(admin, device, body.matchToken, "consume")) !== contact.id) {
        throw new CheckInError("This check-in timed out. Please start again.", 409);
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await admin
          .from("crm_contacts")
          .update({ ...updates, updated_at: now })
          .eq("id", contact.id)
          .eq("organization_id", device.organizationId);
        if (error) throw error;
      }
      // A returning guest with an appointment today: this check-in is the show.
      const today = DateTime.now().setZone(org.timezone);
      const { data: appointment } = await admin
        .from("crm_appointments")
        .select("id, staff_id")
        .eq("organization_id", device.organizationId)
        .eq("contact_id", contact.id)
        .eq("status", "scheduled")
        .gte("scheduled_at", today.startOf("day").toUTC().toISO()!)
        .lte("scheduled_at", today.endOf("day").toUTC().toISO()!)
        .order("scheduled_at")
        .limit(1)
        .maybeSingle();

      const { error: visitError } = await admin.from("guest_visits").insert({
        id: visitId,
        organization_id: device.organizationId,
        contact_id: contact.id,
        visit_type: appointment ? "appointment" : visitType,
        assigned_staff_id: sellerId ?? appointment?.staff_id ?? contact.assigned_staff_id,
        kiosk_device_id: device.deviceId,
      });
      if (visitError) throw visitError;
      if (appointment) {
        await admin
          .from("crm_appointments")
          .update({ status: "showed", visit_id: visitId, updated_at: now })
          .eq("id", appointment.id);
      }
      if (updates.assigned_staff_id) {
        const { data: names } = await admin
          .from("staff")
          .select("id, display_name")
          .in("id", [updates.assigned_staff_id, previousOwner].filter((value): value is string => Boolean(value)));
        const name = (staffId: string | null) => names?.find((row) => row.id === staffId)?.display_name ?? "someone";
        await admin.from("crm_notes").insert({
          organization_id: device.organizationId,
          contact_id: contact.id,
          author_staff_id: updates.assigned_staff_id,
          body: previousOwner
            ? `Reassigned from ${name(previousOwner)} to ${name(updates.assigned_staff_id)} when they checked in again.`
            : `Assigned to ${name(updates.assigned_staff_id)} when they checked in again.`,
        });
      }
      if (signature) {
        const { error } = await admin.from("waiver_signatures").insert(signature);
        if (error) throw error;
      }
      return NextResponse.json({ success: true });
    }

    // --- New guest --------------------------------------------------------
    const details = parseDetails(body.details);
    const howHeard = await validHowHeard(admin, device.organizationId, body.howHeard);
    const consent = (body.consent && typeof body.consent === "object" ? body.consent : {}) as Record<string, unknown>;
    const photo = decodeJpeg(body.photo);
    if (!photo) throw new CheckInError("Please take your photo.");

    let referrerNameTyped: string | null = null;
    let referringClientId: string | null = null;
    if (visitReason === "guest_of_member") {
      referrerNameTyped = cleanText(body.referrerName, 120);
      if (!referrerNameTyped) throw new CheckInError("Enter your friend's first and last name.");
      referringClientId = await resolveReferringMember(admin, device.organizationId, referrerNameTyped);
    }

    // Re-check matches here rather than trusting what the kiosk was told:
    // anything that overlaps an existing contact goes to the pending queue.
    const declinedContactId =
      body.declinedMatchToken !== undefined
        ? await matchTokenContact(admin, device, body.declinedMatchToken, "peek")
        : null;
    const match = await findContactMatch(admin, device.organizationId, details);
    const pending = declinedContactId
      ? { candidateId: declinedContactId, reason: "declined_match" as const }
      : match.kind === "partial"
        ? { candidateId: match.candidate.id, reason: match.reason }
        : match.kind === "full"
          ? { candidateId: match.contact.id, reason: "partial_match" as const }
          : null;

    const contactId = randomUUID();
    const contact: ContactForWaiver = {
      id: contactId,
      first_name: details.firstName,
      last_name: details.lastName,
      date_of_birth: details.dateOfBirth,
      email: details.email,
      phone_e164: details.phone,
      address_line1: details.addressLine1,
      city: details.city,
      state: details.state,
      postal_code: details.postalCode,
    };

    // Files first (an orphaned file is harmless; a contact pointing at a
    // missing file is not), then the rows.
    const signature = await prepareWaiver(admin, request, device, org, contact, visitId, body.waiver);
    const photoPath = `${device.organizationId}/contacts/${contactId}/photo-${randomUUID()}.jpg`;
    await upload(admin, photoPath, photo, "image/jpeg");

    if (declinedContactId) {
      await matchTokenContact(admin, device, body.declinedMatchToken, "consume");
    }

    const { error: contactError } = await admin.from("crm_contacts").insert({
      ...contact,
      organization_id: device.organizationId,
      email_normalized: details.email,
      status: "guest",
      source: visitReason === "membership" ? "walk_in" : "guest_of_member",
      how_heard: howHeard,
      referring_client_id: referringClientId,
      referrer_name_typed: referrerNameTyped,
      referrer_unresolved: visitReason === "guest_of_member" && !referringClientId,
      photo_path: photoPath,
      assigned_staff_id: sellerId,
      email_consent: consent.email === true,
      email_consent_at: consent.email === true ? now : null,
      sms_consent: consent.sms === true,
      sms_consent_at: consent.sms === true ? now : null,
      // Photo consent is part of the waiver text the guest signs (from v2),
      // not a separate checkbox, so it's recorded with the signature.
      photo_consent: true,
      photo_consent_at: now,
      possible_duplicate_of: pending?.candidateId ?? null,
      created_by_kiosk_device_id: device.deviceId,
    });
    if (contactError) throw contactError;

    const { error: visitError } = await admin.from("guest_visits").insert({
      id: visitId,
      organization_id: device.organizationId,
      contact_id: contactId,
      visit_type: visitType,
      assigned_staff_id: sellerId,
      kiosk_device_id: device.deviceId,
    });
    if (visitError) throw visitError;

    const { error: signatureError } = await admin.from("waiver_signatures").insert(signature);
    if (signatureError) throw signatureError;

    if (pending) {
      const { error } = await admin.from("crm_pending_matches").insert({
        organization_id: device.organizationId,
        submitted_contact_id: contactId,
        candidate_contact_id: pending.candidateId,
        reason: pending.reason,
      });
      if (error) throw error;
    }

    // Email deliverability check (Mailgun) runs after the response is sent;
    // the cron retries it if this attempt fails.
    const jobId = await enqueueEmailCheck(admin, device.organizationId, contactId);
    after(() => runJobById(jobId));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CheckInError) {
      return jsonError(error.message, error.status);
    }
    logCrmError("kiosk/check-in", error);
    return jsonError("Something went wrong. Please see the front desk.", 500);
  }
}
