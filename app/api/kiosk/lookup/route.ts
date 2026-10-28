import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientIp, getKioskDevice, sha256 } from "@/lib/crm/kiosk-auth";
import { findContactMatch, firstNameLastInitial } from "@/lib/crm/matching";
import { cleanText, isMinor, normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import { getCrmOrg } from "@/lib/crm/org";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

const MATCH_TOKEN_TTL_MINUTES = 15;

// "Is this you?" (requirement 6). Called by the kiosk once the guest has
// typed their name, email and phone. Returns one of:
//   none        -- carry on as a new guest
//   match       -- email AND phone AND name all match one contact: show
//                  first name + last initial only, plus a one-time token the
//                  kiosk sends back if the guest taps "Yes"
//   front_desk  -- something matched but not cleanly; the guest finishes as
//                  new and the check-in creates a pending match for staff
// Requiring all three to match before anything is shown means the kiosk
// can't be used to find out who owns an email address or phone number; the
// rate limits (per device, per IP, and per email/phone) stop brute force.
export async function POST(request: NextRequest) {
  try {
    const device = await getKioskDevice();
    if (!device) {
      return jsonError("This kiosk isn't paired.", 401);
    }

    const body = await readJsonBody(request);
    const email = normalizeEmail(body?.email);
    const phone = normalizePhone(body?.phone);
    const firstName = cleanText(body?.firstName, 60);
    const lastName = cleanText(body?.lastName, 60);
    if (!email || !phone || !firstName || !lastName) {
      return jsonError("Enter your name, a valid email and a valid mobile number.", 400);
    }

    const ip = clientIp(request.headers) ?? "unknown";
    const allowed = await rateLimitAll([
      { key: `kiosk-lookup:device:${device.deviceId}`, windowSeconds: 600, limit: 30 },
      { key: `kiosk-lookup:device-day:${device.deviceId}`, windowSeconds: 86_400, limit: 300 },
      { key: `kiosk-lookup:ip:${sha256(ip)}`, windowSeconds: 600, limit: 30 },
      { key: `kiosk-lookup:email:${sha256(`${device.organizationId}:${email}`)}`, windowSeconds: 3600, limit: 5 },
      { key: `kiosk-lookup:phone:${sha256(`${device.organizationId}:${phone}`)}`, windowSeconds: 3600, limit: 5 },
    ]);
    if (!allowed) {
      return jsonError("Please see the front desk to finish checking in.", 429);
    }

    const admin = createSupabaseAdminClient();
    const match = await findContactMatch(admin, device.organizationId, { email, phone, firstName, lastName });

    if (match.kind === "none") {
      return NextResponse.json({ success: true, result: "none" });
    }
    if (match.kind === "partial") {
      return NextResponse.json({ success: true, result: "front_desk" });
    }

    const { data: contact, error: contactError } = await admin
      .from("crm_contacts")
      .select("date_of_birth, address_line1, city, state, postal_code")
      .eq("organization_id", device.organizationId)
      .eq("id", match.contact.id)
      .single();
    if (contactError) throw contactError;
    const org = await getCrmOrg(device.organizationId);

    const { count, error: waiverError } = await admin
      .from("waiver_signatures")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", device.organizationId)
      .eq("contact_id", match.contact.id);
    if (waiverError) throw waiverError;

    const token = randomBytes(32).toString("base64url");
    const { error: tokenError } = await admin.from("kiosk_match_tokens").insert({
      token_hash: sha256(token),
      organization_id: device.organizationId,
      kiosk_device_id: device.deviceId,
      contact_id: match.contact.id,
      expires_at: new Date(Date.now() + MATCH_TOKEN_TTL_MINUTES * 60_000).toISOString(),
    });
    if (tokenError) throw tokenError;

    return NextResponse.json({
      success: true,
      result: "match",
      displayName: firstNameLastInitial(match.contact.first_name, match.contact.last_name),
      matchToken: token,
      waiverOnFile: (count ?? 0) > 0,
      // A phone-in lead may have no birth date or address yet; the kiosk
      // then asks for just those before continuing.
      needsDetails: !contact.date_of_birth || !contact.address_line1 || !contact.city || !contact.state || !contact.postal_code,
      // Only known when a birth date is on file; otherwise the kiosk works
      // it out from the date the guest enters (and the server re-checks).
      guardianRequired: contact.date_of_birth ? isMinor(contact.date_of_birth, org.timezone) : null,
    });
  } catch (error) {
    logCrmError("kiosk/lookup", error);
    return jsonError("Something went wrong. Please see the front desk.", 500);
  }
}
