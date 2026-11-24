import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PayrollPerson } from "@/lib/payroll/report";

// One row per session a trainer was paid for, for the Sessions Serviced
// report. Two sources: Mindbody's appointments (what payroll pays today) and
// SynqIQ's pilot close-outs (practice pay, reversals included).

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ServicedRow = {
  key: string;
  staffId: string;
  staffName: string;
  startsAt: string | null; // null: only the date is known
  date: string; // studio date
  client: string;
  session: string;
  pack: { total: number; used: number; left: number } | null;
  packName: string | null;
  valueCents: number | null;
  valueEstimated: boolean;
  rateName: string | null;
  rateDetail: string | null;
  amountCents: number;
  note: string | null; // no-show, late cancel, reversal + reason
};

export function mindbodyServiced(people: PayrollPerson[], dateOf: (iso: string) => string): ServicedRow[] {
  return people.flatMap((person) =>
    person.sessions.map((session) => ({
      key: `mb-${session.appointmentId}`,
      staffId: person.staffId,
      staffName: person.name,
      startsAt: session.startsAt,
      date: dateOf(session.startsAt),
      client: session.clientFull || session.client || "—",
      session: session.sessionType,
      pack: session.pack,
      packName: session.service,
      valueCents: session.valueCents,
      valueEstimated: session.estimated,
      rateName: session.rateName,
      rateDetail: session.rateDetail,
      amountCents: session.amountCents,
      note: session.noShow ? "No-show" : null,
    })),
  );
}

const pct = (bp: number | null) => (bp == null ? null : `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`);

export async function synqiqServiced(admin: Admin, organizationId: string, from: string, to: string): Promise<ServicedRow[]> {
  const { data: events } = await admin
    .from("payroll_events")
    .select(
      "id, staff_id, trainer_session_id, close_no, reverses_event_id, reason, work_date, description, client_name, value_cents, value_estimated, pay_rate_name, rate_method, rate_percent_bp, rate_flat_cents, pay_percent, amount_cents, no_show",
    )
    .eq("organization_id", organizationId)
    .eq("kind", "session")
    .is("voided_at", null)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date")
    .limit(5000);
  const rows = events ?? [];
  const sessionIds = [...new Set(rows.map((row) => row.trainer_session_id as string | null).filter(Boolean))] as string[];
  const staffIds = [...new Set(rows.map((row) => row.staff_id as string))];
  const [{ data: sessions }, { data: uses }, { data: staff }] = await Promise.all([
    sessionIds.length
      ? admin.from("trainer_sessions").select("id, starts_at").in("id", sessionIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    sessionIds.length
      ? admin
          .from("session_pack_uses")
          .select("id, session_pack_id, trainer_session_id, close_no, reverses_use_id, created_at")
          .in("trainer_session_id", sessionIds)
          .is("voided_at", null)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    staffIds.length
      ? admin.from("staff").select("id, display_name").in("id", staffIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const startOf = new Map((sessions ?? []).map((row) => [row.id as string, row.starts_at as string]));
  const nameOf = new Map((staff ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));

  // Each charge's pack use, and where it left the pack.
  const charges = (uses ?? []).filter((use) => !use.reverses_use_id);
  const packIds = [...new Set(charges.map((use) => use.session_pack_id as string))];
  const [{ data: packs }, { data: packUses }] = await Promise.all([
    packIds.length
      ? admin.from("session_packs").select("id, name, total_sessions, opening_remaining").in("id", packIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    packIds.length
      ? admin.from("session_pack_uses").select("session_pack_id, sessions, created_at").in("session_pack_id", packIds).is("voided_at", null)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const packOf = new Map((packs ?? []).map((row) => [row.id as string, row]));
  const position = (packId: string, at: string) => {
    const pack = packOf.get(packId);
    if (!pack || Number(pack.total_sessions) <= 0) return null;
    const total = Number(pack.total_sessions);
    const change = (packUses ?? [])
      .filter((use) => use.session_pack_id === packId && String(use.created_at) <= at)
      .reduce((sum, use) => sum + Number(use.sessions), 0);
    const left = Math.max(0, Number(pack.opening_remaining) + change);
    return { total, used: Math.max(0, total - left), left };
  };
  const useFor = new Map(charges.map((use) => [`${use.trainer_session_id}|${use.close_no}`, use]));

  return rows.map((row) => {
    const use = useFor.get(`${row.trainer_session_id}|${row.close_no}`);
    const reversal = Boolean(row.reverses_event_id);
    const startsAt = row.trainer_session_id ? (startOf.get(row.trainer_session_id as string) ?? null) : null;
    const rateDetail =
      row.rate_method === "percent"
        ? pct(row.rate_percent_bp == null ? null : Number(row.rate_percent_bp))
        : row.rate_method === "flat" && row.rate_flat_cents != null
          ? `$${(Number(row.rate_flat_cents) / 100).toFixed(2)} flat`
          : null;
    const scaled = row.pay_percent != null && Number(row.pay_percent) !== 100 ? ` × ${row.pay_percent}%` : "";
    return {
      key: `sq-${row.id}`,
      staffId: row.staff_id as string,
      staffName: nameOf.get(row.staff_id as string) ?? "Unknown",
      startsAt,
      date: String(row.work_date).slice(0, 10),
      client: (row.client_name as string | null) ?? "—",
      session: String(row.description).replace(/^Reversal: /, ""),
      pack: use && !reversal ? position(use.session_pack_id as string, String(use.created_at)) : null,
      packName: use ? ((packOf.get(use.session_pack_id as string)?.name as string | undefined) ?? null) : null,
      valueCents: row.value_cents == null ? null : Number(row.value_cents),
      valueEstimated: row.value_estimated === true,
      rateName: (row.pay_rate_name as string | null) ?? null,
      rateDetail: rateDetail ? `${rateDetail}${scaled}` : null,
      amountCents: Number(row.amount_cents ?? 0),
      note: reversal ? `Reversed: ${row.reason ?? "correction"}` : row.no_show ? "No-show" : /late cancel/i.test(String(row.description)) ? "Late cancel" : null,
    };
  });
}
