import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { MessageError, sendGuestMessage } from "@/lib/crm/messages";
import { rateLimit } from "@/lib/crm/rate-limit";
import { cleanText } from "@/lib/crm/normalize";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { resolveRequestOrigin } from "@/lib/request-origin";

type RouteParams = { params: Promise<{ id: string }> };

// Sends a text or email to a guest from their profile thread (admins and
// sellers). Texts respect SMS consent, STOP and 8 AM-9 PM quiet hours.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Guest not found.", 404);
    const body = await readJsonBody(request, 40_000);
    const channel =
      body?.channel === "sms" || body?.channel === "email" || body?.channel === "call" ? body.channel : null;
    const text = typeof body?.body === "string" ? body.body.replace(/\r\n?/g, "\n").trim() : "";
    if (!channel) return jsonError("Choose text or email.", 400);
    if (!text) return jsonError("Write a message first.", 400);
    if (channel === "sms" && text.length > 1000) return jsonError("Texts can be up to 1,000 characters.", 400);
    if (text.length > 20000) return jsonError("That message is too long.", 400);

    if (!(await rateLimit(`crm-send:${staff.id}`, 60, 30))) {
      return jsonError("You're sending messages too quickly. Wait a minute.", 429);
    }

    const admin = createSupabaseAdminClient();

    // A phone call the staff member made: logged in the thread (it counts as
    // contacting the lead), nothing is sent.
    if (channel === "call") {
      const { data: contact } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("id", id)
        .eq("organization_id", staff.organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!contact) return jsonError("Guest not found.", 404);
      const now = new Date().toISOString();
      const { data: logged, error: logError } = await admin
        .from("crm_messages")
        .insert({
          organization_id: staff.organizationId,
          contact_id: id,
          channel: "call",
          direction: "outbound",
          body: text,
          sent_by_staff_id: staff.id,
          status: "sent",
          created_at: now,
        })
        .select("id")
        .single();
      if (logError) throw logError;
      await admin.from("crm_contacts").update({ last_message_at: now }).eq("id", id);
      return NextResponse.json({ success: true, id: logged.id });
    }

    const messageId = await sendGuestMessage(admin, {
      organizationId: staff.organizationId,
      staff: { id: staff.id, displayName: staff.displayName },
      contactId: id,
      channel,
      body: text,
      subject: channel === "email" ? cleanText(body?.subject, 200) : null,
      statusCallbackUrl: `${resolveRequestOrigin(request)}/api/crm/sms/status`,
    });
    return NextResponse.json({ success: true, id: messageId });
  } catch (error) {
    if (error instanceof MessageError) return jsonError(error.message, error.status);
    logCrmError("crm/messages POST", error);
    return jsonError("Couldn't send the message.", 500);
  }
}
