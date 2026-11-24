import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRate, toPayRate } from "@/lib/payroll/rates";
import { valueSessions } from "@/lib/payroll/report";
import {
  PAY_PERIOD_ANCHOR,
  payPercentFor,
  periodContaining,
  pickRate,
  sessionPayCents,
  targetPeriodStart,
  type ClosedStatus,
  type DatedRate,
  type SessionRate,
} from "@/lib/trainer/pilot-rules";

// Trainer sessions pilot, server side (service role; callers check roles).
// SynqIQ only: nothing in this file, or anything it calls, writes to
// Mindbody (tests/trainer-pilot-no-mindbody-writes.test.ts checks).

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type PilotSettings = {
  on: boolean;
  timezone: string;
  noShowPercent: number;
  lateCancelPercent: number;
  balancesFrom: string; // the switch date: Mindbody balances stop refreshing
};

export const getTrainerPilot = cache(async function getTrainerPilot(organizationId: string): Promise<PilotSettings> {
  const { data } = await createSupabaseAdminClient()
    .from("organizations")
    .select("trainer_sessions_pilot, timezone, pt_no_show_pay_percent, pt_late_cancel_pay_percent, session_balances_from")
    .eq("id", organizationId)
    .maybeSingle();
  return {
    on: data?.trainer_sessions_pilot === true,
    timezone: (data?.timezone as string | null) ?? "America/Chicago",
    noShowPercent: Number(data?.pt_no_show_pay_percent ?? 100),
    lateCancelPercent: Number(data?.pt_late_cancel_pay_percent ?? 100),
    balancesFrom: String(data?.session_balances_from ?? "2026-12-18").slice(0, 10),
  };
});

// --- Rates ----------------------------------------------------------------------

export type ResolvedRate = SessionRate & { id: string | null; name: string; source: "dated" | "pay_rates"; effectiveFrom: string | null };

const percentLabel = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
export const describeSessionRate = (rate: SessionRate) =>
  rate.method === "flat" ? `$${((rate.flatCents ?? 0) / 100).toFixed(2)} per session` : `${percentLabel(rate.percentBp ?? 0)} of the session's value`;

// THE rate lookup for a trainer session (one place, so pay can later move to
// the session type): the effective-dated pilot rate on the session's date;
// failing that, the trainer's rate on the Pay Rates page (session type
// assignment, else their default session rate).
export async function lookupSessionRate(
  admin: Admin,
  organizationId: string,
  staffId: string,
  sessionTypeId: number | null,
  date: string,
): Promise<ResolvedRate | null> {
  const { data: dated } = await admin
    .from("trainer_session_rates")
    .select("id, staff_id, session_type_id, method, percent_bp, flat_cents, effective_from")
    .eq("organization_id", organizationId)
    .eq("staff_id", staffId)
    .lte("effective_from", date);
  const rates: DatedRate[] = (dated ?? []).map((row) => ({
    id: row.id as string,
    staffId: row.staff_id as string,
    sessionTypeId: row.session_type_id == null ? null : Number(row.session_type_id),
    method: row.method as SessionRate["method"],
    percentBp: row.percent_bp == null ? null : Number(row.percent_bp),
    flatCents: row.flat_cents == null ? null : Number(row.flat_cents),
    effectiveFrom: String(row.effective_from).slice(0, 10),
  }));
  const picked = pickRate(rates, staffId, sessionTypeId, date);
  if (picked) return { ...picked, name: `${describeSessionRate(picked)} (from ${picked.effectiveFrom})`, source: "dated", effectiveFrom: picked.effectiveFrom };

  const [{ data: setting }, { data: assignments }] = await Promise.all([
    admin.from("staff_pay_settings").select("appointment_rate_id").eq("organization_id", organizationId).eq("staff_id", staffId).maybeSingle(),
    admin.from("staff_pay_assignments").select("scope, mindbody_id, pay_rate_id").eq("organization_id", organizationId).eq("staff_id", staffId),
  ]);
  const rateId = resolveRate(
    (assignments ?? []).map((row) => ({ scope: row.scope as string, mindbodyId: Number(row.mindbody_id), payRateId: row.pay_rate_id as string })),
    [{ scope: "session_type", mindbodyId: sessionTypeId }],
    (setting?.appointment_rate_id as string | null) ?? null,
  );
  if (!rateId) return null;
  const { data: row } = await admin.from("pay_rates").select("*").eq("id", rateId).maybeSingle();
  if (!row) return null;
  const rate = toPayRate(row);
  if (rate.method === "flat") return { id: rate.id, name: rate.name, method: "flat", percentBp: null, flatCents: rate.flatCents ?? 0, source: "pay_rates", effectiveFrom: null };
  if (rate.method === "percent")
    return { id: rate.id, name: rate.name, method: "percent", percentBp: Math.round(Number(rate.percent ?? 0) * 100), flatCents: null, source: "pay_rates", effectiveFrom: null };
  return null;
}

// --- Pay periods ----------------------------------------------------------------

// The open period a pay line for `date` belongs in: its own period, or the
// next one that isn't locked. Creates the period row on first use.
export async function payPeriodFor(admin: Admin, organizationId: string, date: string): Promise<{ id: string; startsOn: string }> {
  const own = periodContaining(date, PAY_PERIOD_ANCHOR);
  const { data: locked } = await admin
    .from("pay_periods")
    .select("starts_on")
    .eq("organization_id", organizationId)
    .eq("status", "locked")
    .gte("starts_on", own.startsOn);
  const startsOn = targetPeriodStart(date, new Set((locked ?? []).map((row) => String(row.starts_on).slice(0, 10))));
  const period = periodContaining(startsOn, PAY_PERIOD_ANCHOR);
  await admin
    .from("pay_periods")
    .upsert({ organization_id: organizationId, starts_on: period.startsOn, ends_on: period.endsOn }, { onConflict: "organization_id,starts_on", ignoreDuplicates: true });
  const { data } = await admin.from("pay_periods").select("id, status").eq("organization_id", organizationId).eq("starts_on", period.startsOn).single();
  if (!data || data.status === "locked") throw new Error("No open pay period for this line.");
  return { id: data.id as string, startsOn: period.startsOn };
}

// --- Close-out: pay line ------------------------------------------------------------

export type ClosingSession = {
  id: string;
  trainer_staff_id: string;
  mindbody_client_id: string;
  client_name: string;
  session_type_id: number | null;
  session_type_name: string;
  coverage_name: string | null;
  session_pack_id: string | null;
  local_date: string;
};

// What one session is worth: the pack it came out of (SynqIQ checkout price),
// else Mindbody's purchase history for the client.
async function sessionValue(admin: Admin, organizationId: string, session: ClosingSession) {
  if (session.session_pack_id) {
    const { data: pack } = await admin
      .from("session_packs")
      .select("name, session_value_cents")
      .eq("id", session.session_pack_id)
      .maybeSingle();
    if (pack?.session_value_cents != null) return { valueCents: Number(pack.session_value_cents), estimated: false, source: pack.name as string };
  }
  const values = await valueSessions(admin, organizationId, [
    { key: session.id, clientId: session.mindbody_client_id, serviceName: session.coverage_name, day: session.local_date },
  ]);
  const value = values.get(session.id);
  return { valueCents: value?.valueCents ?? null, estimated: value?.estimated ?? false, source: session.coverage_name };
}

// One pay line per close-out (close_no), at the rate in effect on the
// session's date, copied onto the line. A retry of the same close-out hits the
// unique index and is ignored. Practice until payroll leaves Mindbody.
export async function writeSessionPayLine(
  admin: Admin,
  organizationId: string,
  session: ClosingSession,
  closeNo: number,
  closedAs: ClosedStatus,
  byStaffId: string,
  settings: Pick<PilotSettings, "noShowPercent" | "lateCancelPercent">,
) {
  const [rate, value, period] = await Promise.all([
    lookupSessionRate(admin, organizationId, session.trainer_staff_id, session.session_type_id, session.local_date),
    sessionValue(admin, organizationId, session),
    payPeriodFor(admin, organizationId, session.local_date),
  ]);
  const payPercent = payPercentFor(closedAs, settings);
  const { error } = await admin.from("payroll_events").insert({
    organization_id: organizationId,
    staff_id: session.trainer_staff_id,
    kind: "session",
    trainer_session_id: session.id,
    close_no: closeNo,
    work_date: session.local_date,
    description: `${session.session_type_name}${closedAs === "no_show" ? " (no-show)" : closedAs === "late_cancelled" ? " (late cancel)" : ""}`,
    client_name: session.client_name,
    session_type_id: session.session_type_id,
    value_cents: value.valueCents,
    value_estimated: value.estimated,
    value_source: value.source,
    pay_rate_id: rate?.source === "pay_rates" ? rate.id : null,
    pay_rate_name: rate?.name ?? null,
    rate_method: rate?.method ?? null,
    rate_percent_bp: rate?.percentBp ?? null,
    rate_flat_cents: rate?.flatCents ?? null,
    pay_percent: payPercent,
    amount_cents: sessionPayCents(rate, value.valueCents, payPercent),
    no_show: closedAs === "no_show",
    status: "practice",
    pay_period_id: period.id,
    created_by_staff_id: byStaffId,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

// --- Corrections: reversals, never deletes ------------------------------------------

// Undo a session's current close-out: a negative pay line (in the original's
// period if it's still open, else the next open one) and a ledger entry that
// gives the session back, each with who and why. Safe to repeat.
export async function reverseCloseOut(
  admin: Admin,
  organizationId: string,
  session: { id: string; close_no: number },
  byStaffId: string,
  reason: string,
) {
  // Pay: the live charge for this close-out (or a pre-pilot line without one).
  const { data: charges } = await admin
    .from("payroll_events")
    .select("id, staff_id, kind, work_date, description, client_name, session_type_id, value_cents, value_source, pay_rate_id, pay_rate_name, rate_method, rate_percent_bp, rate_flat_cents, pay_percent, amount_cents, no_show, status, close_no")
    .eq("trainer_session_id", session.id)
    .is("reverses_event_id", null)
    .is("voided_at", null);
  const { data: reversals } = await admin.from("payroll_events").select("reverses_event_id").eq("trainer_session_id", session.id).not("reverses_event_id", "is", null);
  const reversed = new Set((reversals ?? []).map((row) => row.reverses_event_id as string));
  for (const charge of (charges ?? []).filter((row) => !reversed.has(row.id as string))) {
    const period = await payPeriodFor(admin, organizationId, String(charge.work_date).slice(0, 10));
    const { error } = await admin.from("payroll_events").insert({
      organization_id: organizationId,
      staff_id: charge.staff_id,
      kind: charge.kind,
      trainer_session_id: session.id,
      close_no: charge.close_no,
      reverses_event_id: charge.id,
      reason,
      work_date: charge.work_date,
      description: `Reversal: ${charge.description}`,
      client_name: charge.client_name,
      session_type_id: charge.session_type_id,
      value_cents: charge.value_cents,
      value_source: charge.value_source,
      pay_rate_id: charge.pay_rate_id,
      pay_rate_name: charge.pay_rate_name,
      rate_method: charge.rate_method,
      rate_percent_bp: charge.rate_percent_bp,
      rate_flat_cents: charge.rate_flat_cents,
      pay_percent: charge.pay_percent,
      amount_cents: -Number(charge.amount_cents),
      no_show: charge.no_show,
      status: charge.status,
      pay_period_id: period.id,
      created_by_staff_id: byStaffId,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }

  // Ledger: give back the session(s) this close-out took.
  const { data: uses } = await admin
    .from("session_pack_uses")
    .select("id, session_pack_id, sessions, close_no")
    .eq("trainer_session_id", session.id)
    .is("reverses_use_id", null)
    .is("voided_at", null)
    .lt("sessions", 0);
  const { data: usesBack } = await admin.from("session_pack_uses").select("reverses_use_id").eq("trainer_session_id", session.id).not("reverses_use_id", "is", null);
  const given = new Set((usesBack ?? []).map((row) => row.reverses_use_id as string));
  for (const use of (uses ?? []).filter((row) => !given.has(row.id as string))) {
    const { error } = await admin.from("session_pack_uses").insert({
      organization_id: organizationId,
      session_pack_id: use.session_pack_id,
      trainer_session_id: session.id,
      close_no: use.close_no,
      reverses_use_id: use.id,
      kind: "adjustment",
      sessions: -Number(use.sessions),
      reason,
      note: `Reversal: ${reason}`,
      staff_id: byStaffId,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }
}
