import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appointmentPayCents, resolveRate, toPayRate } from "@/lib/payroll/rates";
import { valueSessions } from "@/lib/payroll/report";
import type { Block, Busy } from "@/lib/trainer/rules";

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
  pay: { amountCents: number; valueCents: number | null; rateName: string | null; voided: boolean } | null;
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
        "id, trainer_staff_id, mindbody_client_id, client_name, session_type_id, session_type_name, starts_at, ends_at, status, coverage_name, note, cancel_reason",
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
        .select("trainer_session_id, amount_cents, value_cents, pay_rate_name, voided_at")
        .in("trainer_session_id", sessionIds)
        .order("created_at")
    : { data: [] };
  const payBy = new Map<string, CalendarSession["pay"]>();
  for (const event of events ?? []) {
    const current = payBy.get(event.trainer_session_id as string);
    if (current && !current.voided) continue; // keep the live one
    payBy.set(event.trainer_session_id as string, {
      amountCents: Number(event.amount_cents),
      valueCents: event.value_cents == null ? null : Number(event.value_cents),
      rateName: (event.pay_rate_name as string | null) ?? null,
      voided: Boolean(event.voided_at),
    });
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

// The payroll event for a completed (or charged no-show) session: the
// session's value from the pack that covers it, the trainer's session rate,
// and the pay, snapshotted on the session's date. Practice until payroll
// moves off Mindbody.
export async function writeSessionPayEvent(
  admin: Admin,
  organizationId: string,
  session: {
    id: string;
    trainer_staff_id: string;
    mindbody_client_id: string;
    client_name: string;
    session_type_id: number | null;
    session_type_name: string;
    coverage_name: string | null;
    local_date: string;
  },
  noShow: boolean,
  byStaffId: string,
) {
  const trainer = session.trainer_staff_id;
  const [{ data: setting }, { data: assignments }, values] = await Promise.all([
    admin
      .from("staff_pay_settings")
      .select("appointment_rate_id")
      .eq("organization_id", organizationId)
      .eq("staff_id", trainer)
      .maybeSingle(),
    admin
      .from("staff_pay_assignments")
      .select("scope, mindbody_id, pay_rate_id")
      .eq("organization_id", organizationId)
      .eq("staff_id", trainer),
    valueSessions(admin, organizationId, [
      { key: session.id, clientId: session.mindbody_client_id, serviceName: session.coverage_name, day: session.local_date },
    ]),
  ]);
  const rateId = resolveRate(
    (assignments ?? []).map((row) => ({
      scope: row.scope as string,
      mindbodyId: Number(row.mindbody_id),
      payRateId: row.pay_rate_id as string,
    })),
    [{ scope: "session_type", mindbodyId: session.session_type_id }],
    (setting?.appointment_rate_id as string | null) ?? null,
  );
  const { data: rateRow } = rateId ? await admin.from("pay_rates").select("*").eq("id", rateId).maybeSingle() : { data: null };
  const rate = rateRow ? toPayRate(rateRow) : null;
  const value = values.get(session.id);
  const valueCents = value?.valueCents ?? null;
  const { error } = await admin.from("payroll_events").insert({
    organization_id: organizationId,
    staff_id: trainer,
    kind: "session",
    trainer_session_id: session.id,
    work_date: session.local_date,
    description: `${session.session_type_name}${noShow ? " (no-show)" : ""}`,
    client_name: session.client_name,
    value_cents: valueCents,
    value_estimated: value?.estimated ?? false,
    value_source: session.coverage_name,
    pay_rate_id: rate?.id ?? null,
    pay_rate_name: rate?.name ?? null,
    amount_cents: rate ? appointmentPayCents(rate, valueCents ?? 0) : 0,
    no_show: noShow,
    status: "practice",
    created_by_staff_id: byStaffId,
  });
  if (error) throw new Error(error.message);
}
