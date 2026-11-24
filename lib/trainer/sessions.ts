import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SEMI_PRIVATE_TYPE_IDS, type Block, type Busy } from "@/lib/trainer/rules";

// Server-side loading for the trainer calendar. Service role; callers check
// the role. Mindbody's appointments are read from the nightly sync and shown
// as busy time (SynqIQ never writes to Mindbody).

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MINDBODY_LIVE_STATUSES = ["Booked", "Confirmed", "Arrived", "Completed", "NoShow"];

export type CalendarSession = {
  id: string;
  trainerId: string;
  clientId: string;
  clientName: string;
  sessionTypeId: number | null;
  sessionType: string;
  startsAt: string;
  endsAt: string;
  status: string;
  coverageName: string | null;
  note: string | null;
  cancelReason: string | null;
  roomId: string | null;
  noBalance: boolean;
  // Net pay for the session (charges plus reversals); null when it has none.
  // Only sent to the trainer themself and Club Admins.
  pay: { amountCents: number; valueCents: number | null; rateName: string | null; reversed: boolean } | null;
};
export type CalendarAppointment = {
  id: string;
  trainerId: string;
  clientName: string;
  sessionType: string;
  startsAt: string;
  endsAt: string;
  status: string;
};
export type CalendarBlock = { id: string; trainerId: string; startsAt: string; endsAt: string; source: "mindbody" | "synqiq" };

export async function loadCalendar(admin: Admin, organizationId: string, trainerIds: string[], fromIso: string, toIso: string) {
  if (trainerIds.length === 0) return { sessions: [], appointments: [], blocks: [] };
  const [{ data: sessions }, { data: appts }, { data: blocks }, { data: types }] = await Promise.all([
    admin
      .from("trainer_sessions")
      .select(
        "id, trainer_staff_id, mindbody_client_id, client_name, session_type_id, session_type_name, starts_at, ends_at, status, coverage_name, note, cancel_reason, room_id, no_balance",
      )
      .eq("organization_id", organizationId)
      .in("trainer_staff_id", trainerIds)
      .lt("starts_at", toIso)
      .gt("ends_at", fromIso)
      .order("starts_at")
      .limit(3000),
    admin
      .from("appointment_occurrences")
      .select("id, staff_id, client_id, session_type_id, status, start_datetime, end_datetime")
      .eq("organization_id", organizationId)
      .in("staff_id", trainerIds)
      .in("status", MINDBODY_LIVE_STATUSES)
      .lt("start_datetime", toIso)
      .gt("end_datetime", fromIso)
      .limit(3000),
    admin
      .from("trainer_availability")
      .select("id, staff_id, starts_at, ends_at, source")
      .eq("organization_id", organizationId)
      .in("staff_id", trainerIds)
      .is("deleted_at", null)
      .lt("starts_at", toIso)
      .gt("ends_at", fromIso)
      .order("starts_at")
      .limit(5000),
    admin.from("session_types").select("mindbody_session_type_id, name").eq("organization_id", organizationId),
  ]);
  const typeName = new Map((types ?? []).map((row) => [Number(row.mindbody_session_type_id), row.name as string]));
  const clientIds = [...new Set((appts ?? []).map((row) => row.client_id as string).filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < clientIds.length; i += 300) {
    const { data } = await admin
      .from("clients")
      .select("mindbody_client_id, first_name, last_name")
      .eq("organization_id", organizationId)
      .in("mindbody_client_id", clientIds.slice(i, i + 300));
    for (const row of data ?? []) names.set(row.mindbody_client_id as string, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim());
  }
  const sessionIds = (sessions ?? []).map((row) => row.id as string);
  const { data: events } = sessionIds.length
    ? await admin
        .from("payroll_events")
        .select("trainer_session_id, amount_cents, value_cents, pay_rate_name, voided_at, reverses_event_id")
        .in("trainer_session_id", sessionIds)
        .is("voided_at", null)
        .order("created_at")
    : { data: [] };
  const payBy = new Map<string, NonNullable<CalendarSession["pay"]>>();
  for (const event of events ?? []) {
    const key = event.trainer_session_id as string;
    const current = payBy.get(key) ?? { amountCents: 0, valueCents: null, rateName: null, reversed: false };
    current.amountCents += Number(event.amount_cents);
    if (event.reverses_event_id) current.reversed = true;
    else {
      current.valueCents = event.value_cents == null ? null : Number(event.value_cents);
      current.rateName = (event.pay_rate_name as string | null) ?? null;
    }
    payBy.set(key, current);
  }
  return {
    sessions: (sessions ?? []).map((row): CalendarSession => ({
      id: row.id as string,
      trainerId: row.trainer_staff_id as string,
      clientId: row.mindbody_client_id as string,
      clientName: row.client_name as string,
      sessionTypeId: row.session_type_id == null ? null : Number(row.session_type_id),
      sessionType: row.session_type_name as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      status: row.status as string,
      coverageName: (row.coverage_name as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      cancelReason: (row.cancel_reason as string | null) ?? null,
      roomId: (row.room_id as string | null) ?? null,
      noBalance: row.no_balance === true,
      pay: payBy.get(row.id as string) ?? null,
    })),
    appointments: (appts ?? []).map((row): CalendarAppointment => ({
      id: row.id as string,
      trainerId: row.staff_id as string,
      clientName: names.get(row.client_id as string) ?? "Client",
      sessionType: typeName.get(Number(row.session_type_id)) ?? "Appointment",
      startsAt: row.start_datetime as string,
      endsAt:
        (row.end_datetime as string | null) ??
        DateTime.fromISO(row.start_datetime as string)
          .plus({ minutes: 50 })
          .toISO()!,
      status: row.status as string,
    })),
    blocks: (blocks ?? []).map((row): CalendarBlock => ({
      id: row.id as string,
      trainerId: row.staff_id as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      source: row.source as CalendarBlock["source"],
    })),
  };
}

// Availability and busy time for one trainer around a slot, for the rules.
export async function loadTrainerDay(admin: Admin, organizationId: string, trainerId: string, startsAt: string, endsAt: string) {
  const from = DateTime.fromISO(startsAt).minus({ hours: 12 }).toUTC().toISO()!;
  const to = DateTime.fromISO(endsAt).plus({ hours: 12 }).toUTC().toISO()!;
  const [{ data: blocks }, { data: sessions }, { data: appts }] = await Promise.all([
    admin
      .from("trainer_availability")
      .select("starts_at, ends_at, session_type_ids")
      .eq("organization_id", organizationId)
      .eq("staff_id", trainerId)
      .is("deleted_at", null)
      .lt("starts_at", to)
      .gt("ends_at", from),
    admin
      .from("trainer_sessions")
      .select("id, starts_at, ends_at, session_type_id")
      .eq("organization_id", organizationId)
      .eq("trainer_staff_id", trainerId)
      .in("status", ["booked", "completed", "no_show"])
      .lt("starts_at", to)
      .gt("ends_at", from),
    admin
      .from("appointment_occurrences")
      .select("id, start_datetime, end_datetime, session_type_id")
      .eq("organization_id", organizationId)
      .eq("staff_id", trainerId)
      .in("status", MINDBODY_LIVE_STATUSES)
      .lt("start_datetime", to)
      .gt("end_datetime", from),
  ]);
  const toBlock = (row: Record<string, unknown>): Block => ({
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    sessionTypeIds: (row.session_type_ids as number[] | null) ?? null,
  });
  const busy: Busy[] = [
    ...(sessions ?? []).map((row) => ({
      id: row.id as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      sessionTypeId: row.session_type_id == null ? null : Number(row.session_type_id),
    })),
    ...(appts ?? []).map((row) => ({
      id: `mb:${row.id}`,
      startsAt: row.start_datetime as string,
      endsAt: row.end_datetime as string,
      sessionTypeId: row.session_type_id == null ? null : Number(row.session_type_id),
    })),
  ];
  return { blocks: (blocks ?? []).map(toBlock), busy };
}

// Who else is using the room, and where else the client is, around a slot
// (pilot double-booking checks). Room: other trainer sessions in it, and
// classes whose schedule uses it (not cancelled). A semi-private session for
// the same trainer, type and start shares the room.
export async function loadPlaceBusy(
  admin: Admin,
  organizationId: string,
  input: { roomId: string | null; clientId: string; trainerId: string; sessionTypeId: number | null; startsAt: string; endsAt: string },
) {
  const from = DateTime.fromISO(input.startsAt).minus({ hours: 12 }).toUTC().toISO()!;
  const to = DateTime.fromISO(input.endsAt).plus({ hours: 12 }).toUTC().toISO()!;
  const live = ["booked", "completed", "no_show"];
  const [{ data: clientRows }, roomRows, classRows] = await Promise.all([
    admin
      .from("trainer_sessions")
      .select("id, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", input.clientId)
      .in("status", live)
      .lt("starts_at", to)
      .gt("ends_at", from),
    input.roomId
      ? admin
          .from("trainer_sessions")
          .select("id, trainer_staff_id, session_type_id, starts_at, ends_at")
          .eq("organization_id", organizationId)
          .eq("room_id", input.roomId)
          .in("status", live)
          .lt("starts_at", to)
          .gt("ends_at", from)
          .then((result) => result.data ?? [])
      : Promise.resolve([] as Record<string, unknown>[]),
    input.roomId
      ? admin
          .from("class_schedules")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("room_id", input.roomId)
          .then(async ({ data: schedules }) => {
            const ids = (schedules ?? []).map((row) => row.id as string);
            if (!ids.length) return [] as Record<string, unknown>[];
            const { data } = await admin
              .from("class_sessions")
              .select("id, starts_at, ends_at, edits")
              .eq("organization_id", organizationId)
              .in("class_schedule_id", ids)
              .lt("starts_at", to)
              .gt("ends_at", from);
            return (data ?? []).filter((row) => (row.edits as { active?: boolean } | null)?.active !== false);
          })
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  const sameStart = (iso: string) => Date.parse(iso) === Date.parse(input.startsAt);
  return {
    clientBusy: (clientRows ?? []).map((row) => ({ id: row.id as string, startsAt: row.starts_at as string, endsAt: row.ends_at as string })),
    roomBusy: [
      ...roomRows.map((row) => ({
        id: row.id as string,
        startsAt: row.starts_at as string,
        endsAt: row.ends_at as string,
        sharedSlot:
          row.trainer_staff_id === input.trainerId &&
          input.sessionTypeId != null &&
          Number(row.session_type_id) === input.sessionTypeId &&
          SEMI_PRIVATE_TYPE_IDS.has(input.sessionTypeId) &&
          sameStart(row.starts_at as string),
      })),
      ...classRows.map((row) => ({ id: `class:${row.id}`, startsAt: row.starts_at as string, endsAt: row.ends_at as string })),
    ],
  };
}
