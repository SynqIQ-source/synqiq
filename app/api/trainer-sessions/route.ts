import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCheckInStatus } from "@/lib/checkin/status";
import { bookingCoverage } from "@/lib/booking/rules";
import { canCloseSession, canEditAvailability, canReopenSession, checkBooking, closeSession, type CloseAction } from "@/lib/trainer/rules";
import { loadPlaceBusy, loadTrainerDay } from "@/lib/trainer/sessions";
import { getTrainerPilot, reverseCloseOut, writeSessionPayLine } from "@/lib/trainer/pilot";
import { placeConflicts } from "@/lib/trainer/pilot-rules";
import { syncTrainerAvailability } from "@/lib/trainer/availability-sync";
import { memberPacks, recordSessionUse } from "@/lib/sessions/packs";
import { choosePack, freeSessions } from "@/lib/sessions/packs-rules";

// Trainer calendar actions (SynqIQ only; nothing is written to Mindbody).
// Part of the trainer sessions pilot: off unless the studio turns it on.
//   packs { clientId }                    the client's session packs and what's free
//   book { trainerId, clientId, sessionTypeId, startsAt, minutes, roomId?, note?, packId? }
//   close { id, action: complete|no_show|cancel|late_cancel, reason? }
//   reopen { id, reason }                 Club Admin correction: reverses the
//                                         close-out's pay and session (new rows,
//                                         who + why) and puts it back to booked
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
  const pilot = await getTrainerPilot(org);
  if (!pilot.on) return fail("The trainer sessions pilot is off for this studio. A Club Admin can turn it on in Settings.", 403);
  // While Mindbody is still the record, a Mindbody pack's balance is its last
  // synced balance plus what SynqIQ recorded since (sessions logged in both
  // aren't taken twice).
  const sinceSync = DateTime.now().setZone(zone).toISODate()! < pilot.balancesFrom;

  if (body.action === "packs") {
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    if (!/^[\w-]{1,40}$/.test(clientId)) return fail("Pick a client.");
    const packs = await memberPacks(admin, org, clientId, { sinceSync });
    const today = DateTime.now().setZone(zone).toISODate()!;
    const best = choosePack(packs, today);
    return NextResponse.json({
      success: true,
      best: best?.id ?? null,
      packs: packs
        .filter((pack) => pack.remaining > 0 || pack.reserved > 0)
        .map((pack) => ({ ...pack, free: freeSessions(pack), expired: Boolean(pack.expiresOn && pack.expiresOn < today) })),
    });
  }

  if (body.action === "book") {
    const trainerId = body.trainerId;
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const typeId = Number(body.sessionTypeId);
    const minutes = Math.round(Number(body.minutes));
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const roomId = typeof body.roomId === "string" && body.roomId ? body.roomId : null;
    if (roomId && !uuid(roomId)) return fail("Pick a room.");
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
    if (roomId) {
      const { data: room } = await admin.from("rooms").select("id").eq("id", roomId).eq("organization_id", org).maybeSingle();
      if (!room) return fail("Room not found.", 404);
    }
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
    // SynqIQ's own session packs: the chosen one, else the best one.
    const packs = await memberPacks(admin, org, clientId, { sinceSync });
    const sessionDate = start.toISODate()!;
    const requested = typeof body.packId === "string" && body.packId ? packs.find((pack) => pack.id === body.packId) : undefined;
    if (body.packId && !requested) return fail("That pack isn't on this client's account.");
    const pack = requested ?? choosePack(packs, sessionDate);
    if (requested && (freeSessions(requested) <= 0 || (requested.expiresOn && requested.expiresOn < sessionDate)))
      return fail("That pack has no sessions free on that date. Pick another or book with a reason.", 400, { needsReason: true });
    // Packs in SynqIQ decide coverage; Mindbody's list only when the client has none yet.
    const covered = pack ? true : packs.length ? false : coverage.kind !== "none";
    const day = await loadTrainerDay(admin, org, trainerId as string, startsAt, endsAt);
    const check = checkBooking({
      who,
      trainerId: trainerId as string,
      slot: { startsAt, endsAt, sessionTypeId: typeId },
      blocks: day.blocks,
      busy: day.busy,
      now,
      reason: note,
      covered,
    });
    if (!check.ok) return fail(check.error, 400, { needsReason: Boolean(check.needsReason) });
    // The client and the room can't be double-booked (no override).
    const place = await loadPlaceBusy(admin, org, { roomId, clientId, trainerId: trainerId as string, sessionTypeId: typeId, startsAt, endsAt });
    const placeProblem = placeConflicts({ slot: { startsAt, endsAt }, roomBusy: place.roomBusy, clientBusy: place.clientBusy });
    if (placeProblem) return fail(placeProblem);
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
        coverage_kind: pack || (!packs.length && coverage.kind === "pack") ? "pack" : "none",
        coverage_name: pack ? pack.name : packs.length ? null : coverage.name,
        mindbody_client_service_id: pack || packs.length ? null : coverage.serviceId,
        session_pack_id: pack?.id ?? null,
        room_id: roomId,
        no_balance: !covered,
        note: [note, ...check.warnings.map((w) => `(${w})`)].filter(Boolean).join(" ") || null,
        booked_by_staff_id: me.id,
      })
      .select("id")
      .single();
    if (error) return fail("Couldn't book. Try again.", 500);
    return NextResponse.json({
      success: true,
      id: saved.id,
      coverage: pack ? pack.name : coverage.name,
      sessionsLeftAfter: pack ? freeSessions(pack) - 1 : null,
      noBalance: !covered,
      warnings: check.warnings,
    });
  }

  if (body.action === "close" || body.action === "reopen") {
    if (!uuid(body.id)) return fail("Pick a session.");
    const { data: session } = await admin
      .from("trainer_sessions")
      .select(
        "id, trainer_staff_id, mindbody_client_id, client_name, session_type_id, session_type_name, coverage_name, local_date, starts_at, status, session_pack_id, close_no",
      )
      .eq("id", body.id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!session) return fail("Session not found.", 404);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

    if (body.action === "reopen") {
      if (!canReopenSession(who)) return fail("Only a Club Admin can correct a closed session.", 403);
      if (session.status === "booked") return fail("This session is still open.");
      if (!reason) return fail("Add a reason.");
      try {
        // Reversal rows (never deletes): the pay line and the session it took.
        await reverseCloseOut(admin, org, { id: session.id as string, close_no: Number(session.close_no ?? 0) }, me.id, reason);
      } catch (error) {
        console.error("[trainer-sessions] correction failed:", error);
        return fail(error instanceof Error && /locked/i.test(error.message) ? error.message : "Couldn't correct this session. Try again.", 500);
      }
      await admin
        .from("trainer_sessions")
        .update({ status: "booked", closed_at: null, closed_by_staff_id: null, cancel_reason: null, updated_at: now.toISOString() })
        .eq("id", session.id)
        .neq("status", "booked");
      return NextResponse.json({ success: true });
    }

    if (!canCloseSession(who, session.trainer_staff_id as string))
      return fail("Only the trainer, a Sales Lead or a Club Admin can close out this session.", 403);
    const action = body.action === "close" ? (body.actionType as CloseAction) : null;
    if (!action || !["complete", "no_show", "cancel", "late_cancel"].includes(action)) return fail("Pick what happened.");
    const outcome = closeSession({ status: session.status as string, action, startsAt: session.starts_at as string, now });
    if (!outcome.ok) return fail(outcome.error);
    // Only one request wins the change from booked; each close-out gets the
    // next close_no, which its ledger entry and pay line carry (retries and
    // double clicks can't add a second one).
    const closeNo = Number(session.close_no ?? 0) + 1;
    const { data: changed } = await admin
      .from("trainer_sessions")
      .update({
        status: outcome.status,
        close_no: closeNo,
        closed_at: now.toISOString(),
        closed_by_staff_id: me.id,
        cancel_reason: action === "cancel" || action === "late_cancel" ? reason || null : null,
        updated_at: now.toISOString(),
      })
      .eq("id", session.id)
      .eq("status", "booked")
      .eq("close_no", closeNo - 1)
      .select("id");
    if (!changed?.length) return fail("Someone else just closed this session. Refresh.");
    const closing = {
      id: session.id as string,
      trainer_staff_id: session.trainer_staff_id as string,
      mindbody_client_id: session.mindbody_client_id as string,
      client_name: session.client_name as string,
      session_type_id: session.session_type_id == null ? null : Number(session.session_type_id),
      session_type_name: session.session_type_name as string,
      coverage_name: (session.coverage_name as string | null) ?? null,
      session_pack_id: (session.session_pack_id as string | null) ?? null,
      local_date: String(session.local_date),
    };
    if (outcome.pays) {
      try {
        await writeSessionPayLine(admin, org, closing, closeNo, outcome.status as "completed" | "no_show" | "late_cancelled", me.id, pilot);
      } catch (error) {
        console.error("[trainer-sessions] pay line failed:", error);
        await admin
          .from("trainer_sessions")
          .update({ status: "booked", closed_at: null, closed_by_staff_id: null })
          .eq("id", session.id)
          .eq("close_no", closeNo);
        return fail("Couldn't record the pay for this session. Try again.", 500);
      }
    }
    // Completed, no-show and late cancel each take a session off the pack
    // (the studio's settings decide for no-show and late cancel).
    try {
      await recordSessionUse(admin, org, session.id as string, closing.session_pack_id, outcome.status, me.id, closeNo);
    } catch (error) {
      console.error("[trainer-sessions] session use not recorded:", error);
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
