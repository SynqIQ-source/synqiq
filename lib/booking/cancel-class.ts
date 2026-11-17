import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyCatalogEdit } from "@/lib/classes/catalog-edits";
import { findStudio, memberPortalAllowed } from "@/lib/member/session";
import { sendEmailToRecipients } from "@/lib/email/send";
import { getOptionalEnv } from "@/lib/env";

// Cancelling one class date in SynqIQ: the date is marked not happening
// (with the reason, for staff only: catalog change log + class page; never
// in the member email), everyone booked or on the
// waitlist in SynqIQ has their spot cancelled -- never a late cancel or a
// fee -- and is emailed. During the parallel run only members with access to
// SynqIQ's booking (testers) are emailed; Mindbody's own bookings for the
// class are Mindbody's to handle until the switch.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const STUDIO_CANCEL_REASON = "Class cancelled by the studio";

export async function cancelClassSession(input: { organizationId: string; sessionId: string; staffId: string; reason: string }) {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("class_sessions")
    .select("*")
    .eq("id", input.sessionId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!row) return { ok: false as const, error: "Class not found." };
  const result = applyCatalogEdit("class_session", row as Record<string, unknown> & { edits?: Record<string, never> }, {
    set: { active: false, note: input.reason },
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  if (Object.keys(result.changes).length) {
    const { error } = await admin.from("class_sessions").update({ edits: result.edits }).eq("id", input.sessionId);
    if (error) return { ok: false as const, error: "Couldn't cancel the class. Try again." };
    await admin.from("catalog_edits").insert({
      organization_id: input.organizationId,
      entity: "class_session",
      row_id: input.sessionId,
      changes: result.changes,
      edited_by_staff_id: input.staffId,
    });
  }
  const notified = await releaseCancelledClass(admin, input);
  return { ok: true as const, ...notified };
}

// The bookings side (also used when the date is switched off in Class
// Catalog): cancel SynqIQ bookings and waitlist spots, then email them.
export async function releaseCancelledClass(
  admin: Admin,
  input: { organizationId: string; sessionId: string; staffId: string; reason: string },
) {
  const now = new Date().toISOString();
  const { data: released } = await admin
    .from("class_bookings")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by_staff_id: input.staffId,
      cancel_reason: STUDIO_CANCEL_REASON,
      late_cancel_fee_cents: null,
      updated_at: now,
    })
    .eq("organization_id", input.organizationId)
    .eq("class_session_id", input.sessionId)
    .in("status", ["booked", "waitlisted"])
    .select("mindbody_client_id, client_name, status");
  const people = released ?? [];
  if (!people.length) return { cancelledBookings: 0, emailed: 0 };

  const [{ data: session }, { data: org }] = await Promise.all([
    admin.from("class_sessions").select("class_name, starts_at").eq("id", input.sessionId).maybeSingle(),
    admin.from("organizations").select("name, timezone, mindbody_site_id").eq("id", input.organizationId).maybeSingle(),
  ]);
  const studio = org?.mindbody_site_id ? await findStudio(Number(org.mindbody_site_id)) : null;
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const when = session?.starts_at
    ? DateTime.fromISO(session.starts_at as string)
        .setZone(zone)
        .toFormat("cccc, LLL d 'at' h:mm a")
    : "";
  const studioName = (org?.name as string | null) ?? "Your studio";
  const ids = people.map((person) => person.mindbody_client_id as string);
  const [{ data: clients }, { data: personal }] = await Promise.all([
    admin
      .from("clients")
      .select("mindbody_client_id, first_name, email")
      .eq("organization_id", input.organizationId)
      .in("mindbody_client_id", ids),
    admin
      .from("member_personal")
      .select("mindbody_client_id, edits")
      .eq("organization_id", input.organizationId)
      .in("mindbody_client_id", ids),
  ]);
  const edited = new Map(
    (personal ?? []).map((row) => [row.mindbody_client_id as string, (row.edits as { email?: string | null } | null)?.email]),
  );
  const siteUrl = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
  let emailed = 0;
  for (const client of clients ?? []) {
    const id = client.mindbody_client_id as string;
    const email = edited.get(id) !== undefined ? edited.get(id) : (client.email as string | null);
    if (!email || !studio || !(await memberPortalAllowed(studio, id))) continue;
    await sendEmailToRecipients([{ email }], {
      from: `${studioName.replace(/[<>"]/g, "")} <notifications@synqiq.co>`,
      ...cancelledClassEmail({
        studioName,
        firstName: (client.first_name as string | null) ?? "",
        className: (session?.class_name as string | null)?.trim() ?? "Your class",
        when,
        bookUrl: `${siteUrl}/m/${studio.siteId}`,
      }),
    });
    emailed += 1;
  }
  return { cancelledBookings: people.length, emailed };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// Informative and mildly apologetic. No reason: that's for staff only.
export function cancelledClassEmail(input: { studioName: string; firstName: string; className: string; when: string; bookUrl: string }) {
  const className = escapeHtml(input.className);
  const when = input.when ? ` on ${escapeHtml(input.when)}` : "";
  return {
    subject: `Class cancelled: ${input.className}${input.when ? `, ${input.when}` : ""}`,
    html: `
      <p>Hi ${escapeHtml(input.firstName || "there")},</p>
      <p>We're sorry to let you know that <strong>${className}</strong>${when} has been cancelled. We apologize for the inconvenience.</p>
      <p>You don't need to do anything: your spot has been released, and it won't count as a late cancel or cost you anything.</p>
      <p>We'd love to see you in another class this week.</p>
      <p><a href="${escapeHtml(input.bookUrl)}">See the schedule and book</a></p>
      <p>Thank you for understanding,<br>${escapeHtml(input.studioName)}</p>
    `,
  };
}
