import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendInstructorFollowup } from "@/lib/followup/relay";

// The relay send does a few sequential Supabase round trips plus a Resend
// call.
export const runtime = "nodejs";
export const maxDuration = 30;

// How far back a member's check-in still qualifies them for a follow-up
// from this instructor. Wider than the roster view's window so a slightly
// stale page still submits successfully.
const ELIGIBILITY_WINDOW_DAYS = 90;

const DEFAULT_SUBJECT = "Checking in";

// POST /api/followup
//   new/continued outreach:  { clientId, subject?, body }
//   reply in a thread:       { conversationId, body }
export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();
    if (!currentStaff) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const bodyText = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!bodyText) {
      return NextResponse.json({ error: "Message body is required." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const conversationId: string | undefined = payload?.conversationId;
    const clientId: string | undefined = payload?.clientId;

    // --- reply to an existing thread ---------------------------------------
    if (conversationId) {
      const { data: conversation } = await admin
        .from("followup_conversations")
        .select("id, organization_id, instructor_id, client_id, subject")
        .eq("id", conversationId)
        .maybeSingle();

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
      if (conversation.instructor_id !== currentStaff.id) {
        return NextResponse.json({ error: "Not your conversation." }, { status: 403 });
      }

      const result = await sendInstructorFollowup({
        organizationId: conversation.organization_id,
        instructorId: currentStaff.id,
        clientId: conversation.client_id,
        subject: conversation.subject,
        bodyText,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 502 });
      }
      return NextResponse.json({ ok: true, conversationId: result.conversationId });
    }

    // --- new / continued outreach to a member ----------------------------
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId or conversationId is required." },
        { status: 400 },
      );
    }

    const { data: client } = await admin
      .from("clients")
      .select("id, organization_id, mindbody_unique_id, email")
      .eq("id", clientId)
      .maybeSingle();

    if (!client) {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }
    if (client.organization_id !== currentStaff.organizationId) {
      return NextResponse.json({ error: "Member is in another organization." }, { status: 403 });
    }
    if (!client.email) {
      return NextResponse.json(
        { error: "This member has no email on file yet." },
        { status: 409 },
      );
    }

    // Server-side re-check of the rule the UI enforces: an instructor can
    // only follow up with someone who actually checked in to one of their
    // own (or covered) classes.
    const windowStart = DateTime.utc().minus({ days: ELIGIBILITY_WINDOW_DAYS }).toISO();

    const { data: occurrences } = await admin
      .from("class_occurrences")
      .select("id")
      .or(`staff_id.eq.${currentStaff.id},substitute_staff_id.eq.${currentStaff.id}`)
      .not("mindbody_occurrence_id", "is", null)
      .gte("start_datetime", windowStart);

    const occurrenceIds = (occurrences ?? []).map((row) => row.id);

    let eligible = false;
    if (occurrenceIds.length > 0) {
      const { data: visit } = await admin
        .from("class_visits")
        .select("id")
        .eq("signed_in", true)
        .eq("client_mindbody_unique_id", client.mindbody_unique_id)
        .in("occurrence_id", occurrenceIds)
        .limit(1)
        .maybeSingle();
      eligible = Boolean(visit);
    }

    if (!eligible) {
      return NextResponse.json(
        { error: "You can only follow up with members who checked in to one of your classes." },
        { status: 403 },
      );
    }

    const subject =
      typeof payload?.subject === "string" && payload.subject.trim()
        ? payload.subject.trim()
        : DEFAULT_SUBJECT;

    const result = await sendInstructorFollowup({
      organizationId: currentStaff.organizationId,
      instructorId: currentStaff.id,
      clientId: client.id,
      subject,
      bodyText,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, conversationId: result.conversationId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
