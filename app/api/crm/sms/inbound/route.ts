import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/crm/normalize";
import { optKeyword, verifyTwilioSignature } from "@/lib/crm/sms";
import { recordInbound } from "@/lib/crm/messages";
import { logCrmError } from "@/lib/crm/http";
import { resolveRequestOrigin } from "@/lib/request-origin";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml() {
  return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}

// Twilio "A message comes in" webhook. The org is resolved from the number
// the guest texted (organizations.crm_sms_number) and the guest from their
// number. STOP/START keywords update the guest's opt-out; Twilio itself
// also blocks texts to anyone who sent STOP and replies with the standard
// confirmation, so no auto-reply is sent from here.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const url = `${resolveRequestOrigin(request)}${request.nextUrl.pathname}`;
  if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  try {
    const from = normalizePhone(params.get("From") ?? "");
    const to = normalizePhone(params.get("To") ?? "");
    const body = (params.get("Body") ?? "").trim();
    const sid = params.get("MessageSid");
    if (!from || !to) return twiml();

    const admin = createSupabaseAdminClient();
    const { data: org } = await admin.from("organizations").select("id").eq("crm_sms_number", to).maybeSingle();
    if (!org) return twiml();

    // The guest with this number (most recent if there are duplicates).
    const { data: matches, error } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("organization_id", org.id)
      .eq("phone_e164", from)
      .is("merged_into_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;

    let contactId = matches?.[0]?.id as string | undefined;
    if (!contactId) {
      // Someone not in the CRM texted the studio: start a lead so the text
      // isn't lost. Staff fill in the name.
      const { data: created, error: createError } = await admin
        .from("crm_contacts")
        .insert({
          organization_id: org.id,
          first_name: "Unknown",
          last_name: "texter",
          phone_e164: from,
          status: "lead",
          source: "other",
          email_check_status: "skipped",
          sms_consent: true,
          sms_consent_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (createError) throw createError;
      contactId = created.id as string;
    }

    const keyword = optKeyword(body);
    if (keyword) {
      await admin
        .from("crm_contacts")
        .update(
          keyword === "out"
            ? { sms_opted_out_at: new Date().toISOString() }
            : { sms_opted_out_at: null, sms_consent: true, sms_consent_at: new Date().toISOString() },
        )
        .eq("id", contactId);
    }

    await recordInbound(admin, {
      organizationId: org.id,
      contactId,
      channel: "sms",
      body: body || "(picture or empty message)",
      providerMessageId: sid,
    });
    return twiml();
  } catch (error) {
    logCrmError("crm/sms inbound", error);
    // 500 so Twilio retries rather than losing the text.
    return new NextResponse("error", { status: 500 });
  }
}
