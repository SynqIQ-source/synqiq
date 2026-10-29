import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/crm/sms";
import { logCrmError } from "@/lib/crm/http";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Twilio delivery-status callback for texts sent from SynqIQ: marks the
// message delivered or failed in the guest's thread.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const url = `${resolveRequestOrigin(request)}${request.nextUrl.pathname}`;
  if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  try {
    const sid = params.get("MessageSid");
    const status = params.get("MessageStatus");
    const next =
      status === "delivered"
        ? "delivered"
        : status === "failed" || status === "undelivered"
          ? "failed"
          : null;
    if (sid && next) {
      const errorCode = params.get("ErrorCode");
      await createSupabaseAdminClient()
        .from("crm_messages")
        .update({ status: next, error: next === "failed" ? `Not delivered${errorCode ? ` (Twilio ${errorCode})` : ""}` : null })
        .eq("provider_message_id", sid)
        .eq("direction", "outbound");
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logCrmError("crm/sms status", error);
    return new NextResponse("error", { status: 500 });
  }
}
