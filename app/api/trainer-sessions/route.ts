import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCheckInStatus } from "@/lib/checkin/status";
import { bookingCoverage } from "@/lib/booking/rules";
import { canCloseSession, canEditAvailability, canReopenSession, checkBooking, closeSession, type CloseAction } from "@/lib/trainer/rules";
import { loadTrainerDay, writeSessionPayEvent } from "@/lib/trainer/sessions";
import { syncTrainerAvailability } from "@/lib/trainer/availability-sync";

// Trainer calendar actions (SynqIQ only; nothing is written to Mindbody):
//   book { trainerId, clientId, sessionTypeId, startsAt, minutes, note? }
//   close { id, action: complete|no_show|cancel|late_cancel, reason? }
//   reopen { id, reason }                 Club Admin: back to booked, voids its pay
//   availabilityAdd { trainerId, date, start, end, weeks }
//   availabilityDelete { id }             SynqIQ-added hours only
//   refresh {}                            re-copy availability from Mindbody
export async function POST(request: NextRequest) {
  const me = await getCurrentStaff();
  if (!me || !canCheckIn(me)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const org = me.organizationId;
  const who = { id: me.id, role: me.role, isTrainer: me.isTrainer };
  const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ success: false, error, ...extra }, { status });
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
  const { data: orgRow } = await admin.from("organizations").select("timezone, trainer_availability_synced_at").eq("id", org).maybeSingle();
  const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const now = new Date();

  if (body.action === "book") {
    const trainerId = body.trainerId;
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const typeId = Number(body.sessionTypeId);
    const minutes = Math.round(Number(body.minutes));
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const start = typeof body.startsAt === "string" ? DateTime.fromISO(body.startsAt, { zone }) : null;
    if (!uuid(trainerId) || !/^[\w-]{1,40}$/.test(clientId) || !start?.isValid) return fail("Pick a trainer, a client and a time.");
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 240) return fail("Pick a length between 10 minutes and 4 hours.");
    const [{ data: trainer }, { data: type }, person] = await Promise.all([
      admin.from("staff").select("id, display_name").eq("id", trainerId).eq("organization_id", org).maybeSingle(),
      admin
        .from("session_types")
        .select("mindbody_session_type_id, name, mindbody_program_id")
        .eq("organization_id", org)
        .eq("mindbody_session_type_id", typeId)
        .maybeSingle(),
      loadCheckInStatus(org, clientId),
    ]);
    if (!trainer) return fail("Trainer not found.", 404);
    if (!type) return fail("Pick a session type.");
    if (!person) return fail("Client not found.", 404);
    const startsAt = start.toUTC().toISO()!;
    const endsAt = start.plus({ minutes }).toUTC().toISO()!;
    const { data: program } = type.mindbody_program_id
      ? await admin
          .from("departments")
          .select("name")
          .eq("organization_id", org)
          .eq("mindbody_program_id", type.mindbody_program_id)
          .maybeSingle()
      : { data: null };
    const coverage = bookingCoverage({
      rules: {
        name: (program?.name as string | undefined) ?? "Personal Training",
        includedInMembership: false,
        bookingOpensDays: null,
        bookingClosesMinutes: null,
        cancelWindowMinutes: null,
        lateCancelFeeCents: 0,
      },
      services: person.services,
      membershipProgram: "Memberships & Passes",
      date: start.toISODate()!,
      hasCurrentMembership: false,
    });
    const day = await loadTrainerDay(admin, org, trainerId as string, startsAt, endsAt);
    const check = checkBooking({
      who,
      trainerId: trainerId as string,
      slot: { startsAt, endsAt, sessionTypeId: typeId },
      blocks: day.blocks,
      busy: day.busy,
      now,
      reason: note,
      covered: coverage.kind !== "none",
    });
    if (!check.ok) return fail(check.error, 400, { needsReason: Boolean(check.needsReason) });
    const { data: saved, error } = await admin
      .from("trainer_sessions")
      .insert({
        organization_id: org,
        trainer_staff_id: trainerId,
        mindbody_client_id: clientId,
        client_name: person.client.name,
        session_type_id: typeId,
        session_type_name: type.name,
        starts_at: startsAt,
        ends_at: endsAt,
        local_date: start.toISODate(),
        coverage_kind: coverage.kind === "pack" ? "pack" : "none",
        coverage_name: coverage.name,
        mindbody_client_service_id: coverage.serviceId,
        note: [note, ...check.warnings.map((w) => `(${w})`)].filter(Boolean).join(" ") || null,
        booked_by_staff_id: me.id,
      })
      .select("id")
      .single();
    if (error) return fail("Couldn't book. Try again.", 500);
    return NextResponse.json({ success: true, id: saved.id, coverage: coverage.name, warnings: check.warnings });
  }

  if (body.action === "close" || body.action === "reopen") {
    if (!uuid(body.id)) return fail("Pick a session.");
    const { data: session } = await admin
      .from("trainer_sessions")
      .select(
        "id, trainer_staff_id, mindbody_client_id, client_name, session_type_id, session_type_name, coverage_name, local_date, starts_at, status",
      )
      .eq("id", body.id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!session) return fail("Session not found.", 404);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

    if (body.action === "reopen") {
      if (!canReopenSession(who)) return fail("Only a Club Admin can reopen a session.", 403);
      if (session.status === "booked") return fail("This session is still open.");
      if (!reason) return fail("Add a reason.");
      await admin
        .from("payroll_events")
        .update({ voided_at: now.toISOString(), voided_by_staff_id: me.id, void_reason: reason })
        .eq("trainer_session_id", session.id)
        .is("voided_at", null);
      await admin
        .from("trainer_sessions")
        .update({ status: "booked", closed_at: null, closed_by_staff_id: null, cancel_reason: null, updated_at: now.toISOString() })
        .eq("id", session.id);
      return NextResponse.json({ success: true });
    }

    if (!canCloseSession(who, session.trainer_staff_id as string))
      return fail("Only the trainer, a Sales Lead or a Club Admin can close out this session.", 403);
    const action = body.action === "close" ? (body.actionType as CloseAction) : null;
    if (!action || !["complete", "no_show", "cancel", "late_cancel"].includes(action)) return fail("Pick what happened.");
    const outcome = closeSession({ status: session.status as string, action, startsAt: session.starts_at as string, now });
    if (!outcome.ok) return fail(outcome.error);
    // Only one request wins the change from booked.
    const { data: changed } = await admin
      .from("trainer_sessions")
      .update({
        status: outcome.status,
        closed_at: now.toISOString(),
        closed_by_staff_id: me.id,
        cancel_reason: action === "cancel" || action === "late_cancel" ? reason || null : null,
        updated_at: now.toISOString(),
      })
      .eq("id", session.id)
      .eq("status", "booked")
      .select("id");
    if (!changed?.length) return fail("Someone else just closed this session. Refresh.");
    if (outcome.pays) {
      try {
        await writeSessionPayEvent(
          admin,
          org,
          {
            id: session.id as string,
            trainer_staff_id: session.trainer_staff_id as string,
            mindbody_client_id: session.mindbody_client_id as string,
            client_name: session.client_name as string,
            session_type_id: session.session_type_id == null ? null : Number(session.session_type_id),
            session_type_name: session.session_type_name as string,
            coverage_name: (session.coverage_name as string | null) ?? null,
            local_date: String(session.local_date),
          },
          outcome.noShow,
          me.id,
        );
      } catch (error) {
        console.error("[trainer-sessions] pay event failed:", error);
        await admin.from("trainer_sessions").update({ status: "booked", closed_at: null, closed_by_staff_id: null }).eq("id", session.id);
        return fail("Couldn't record the pay for this session. Try again.", 500);
      }
    }
    return NextResponse.json({ success: true, status: outcome.status });
  }

  if (body.action === "availabilityAdd") {
    const trainerId = body.trainerId;
    if (!uuid(trainerId)) return fail("Pick a trainer.");
    if (!canEditAvailability(who, trainerId as string)) return fail("Only the trainer or a Club Admin can change their hours.", 403);
    const date = typeof body.date === "string" ? body.date : "";
    const startTime = typeof body.start === "string" ? body.start : "";
    const endTime = typeof body.end === "string" ? body.end : "";
    const weeks = Math.min(26, Math.max(1, Math.round(Number(body.weeks ?? 1))));
    const first = DateTime.fromISO(`${date}T${startTime}`, { zone });
    const firstEnd = DateTime.fromISO(`${date}T${endTime}`, { zone });
    if (!first.isValid || !firstEnd.isValid || firstEnd <= first) return fail("Pick a day and a start and end time.");
    const rows = Array.from({ length: weeks }, (_, i) => ({
      organization_id: org,
      staff_id: trainerId,
      source: "synqiq",
      starts_at: first.plus({ weeks: i }).toUTC().toISO(),
      ends_at: firstEnd.plus({ weeks: i }).toUTC().toISO(),
      created_by_staff_id: me.id,
    }));
    const { error } = await admin.from("trainer_availability").insert(rows);
    if (error) return fail("Couldn't save. Try again.", 500);
    return NextResponse.json({ success: true, added: rows.length });
  }

  if (body.action === "availabilityDelete") {
    if (!uuid(body.id)) return fail("Pick the hours to remove.");
    const { data: block } = await admin
      .from("trainer_availability")
      .select("id, staff_id, source")
      .eq("id", body.id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!block) return fail("Not found.", 404);
    if (!canEditAvailability(who, block.staff_id as string)) return fail("Only the trainer or a Club Admin can change their hours.", 403);
    if (block.source !== "synqiq") return fail("These hours come from Mindbody. Change them there until the switch.");
    await admin.from("trainer_availability").update({ deleted_at: now.toISOString() }).eq("id", block.id);
    return NextResponse.json({ success: true });
  }

  if (body.action === "refresh") {
    const last = orgRow?.trainer_availability_synced_at ? Date.parse(orgRow.trainer_availability_synced_at as string) : 0;
    if (now.getTime() - last < 5 * 60_000) return NextResponse.json({ success: true, skipped: true });
    try {
      const result = await syncTrainerAvailability(org);
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      console.error("[trainer-sessions] availability refresh failed:", error);
      return fail("Couldn't reach Mindbody. Try again later.", 502);
    }
  }
  return fail("Unknown action.");
}
