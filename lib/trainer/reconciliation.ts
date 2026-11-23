import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reconcile, type MindbodyVisit, type ReconRow, type SynqClosed } from "@/lib/trainer/pilot-rules";

// Pilot reconciliation (read-only): SynqIQ trainer session close-outs vs the
// appointments and pack balances synced from Mindbody, for a date range.
// Reads only; nothing is written anywhere.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const MINDBODY_DONE = ["Completed", "Arrived", "NoShow", "LateCancelled"];

export type BalanceRow = {
  clientId: string;
  clientName: string;
  pack: string;
  synqiq: number; // SynqIQ's balance (Mindbody's last sync + SynqIQ entries since)
  mindbody: number; // Mindbody's remaining at the last sync
  usedInSynqiqSinceSync: number;
};

export async function loadReconciliation(admin: Admin, organizationId: string, from: string, to: string, zone: string) {
  const startIso = DateTime.fromISO(from, { zone }).startOf("day").toUTC().toISO()!;
  const endIso = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!;
  const [{ data: sessions }, { data: appts }, { data: trainers }] = await Promise.all([
    admin
      .from("trainer_sessions")
      .select("id, trainer_staff_id, mindbody_client_id, client_name, local_date, status, session_type_name")
      .eq("organization_id", organizationId)
      .gte("local_date", from)
      .lte("local_date", to)
      .in("status", ["completed", "no_show", "late_cancelled"])
      .limit(5000),
    admin
      .from("appointment_occurrences")
      .select("id, staff_id, client_id, session_type_id, status, start_datetime")
      .eq("organization_id", organizationId)
      .gte("start_datetime", startIso)
      .lt("start_datetime", endIso)
      .in("status", MINDBODY_DONE)
      .limit(5000),
    admin.from("staff").select("id, display_name").eq("organization_id", organizationId).eq("is_trainer", true),
  ]);
  const { data: types } = await admin.from("session_types").select("mindbody_session_type_id, name").eq("organization_id", organizationId);
  const typeName = new Map((types ?? []).map((t) => [Number(t.mindbody_session_type_id), t.name as string]));
  const trainerName = new Map((trainers ?? []).map((t) => [t.id as string, (t.display_name as string | null) ?? "Trainer"]));
  const synq: SynqClosed[] = (sessions ?? []).map((row) => ({
    id: row.id as string,
    trainerId: row.trainer_staff_id as string,
    clientId: row.mindbody_client_id as string,
    date: String(row.local_date).slice(0, 10),
    status: row.status as string,
    sessionType: row.session_type_name as string,
  }));
  const mindbody: MindbodyVisit[] = (appts ?? [])
    .filter((row) => row.client_id)
    .map((row) => ({
      id: row.id as string,
      trainerId: (row.staff_id as string | null) ?? null,
      clientId: String(row.client_id),
      date: DateTime.fromISO(row.start_datetime as string).setZone(zone).toISODate()!,
      status: row.status as string,
      sessionType: typeName.get(Number(row.session_type_id)) ?? "Appointment",
    }));
  // Only compare trainers who are in the pilot (have a SynqIQ session in range),
  // so Mindbody-only trainers don't flood the list.
  const pilotTrainers = new Set(synq.map((s) => s.trainerId));
  const rows = reconcile(
    synq,
    mindbody.filter((visit) => visit.trainerId && pilotTrainers.has(visit.trainerId)),
  );

  const clientIds = [...new Set(rows.map((r) => (r.kind === "mindbody_only" ? r.mindbody.clientId : r.synq.clientId)))];
  const names = new Map<string, string>((sessions ?? []).map((row) => [row.mindbody_client_id as string, row.client_name as string]));
  const missing = clientIds.filter((id) => !names.has(id));
  for (let i = 0; i < missing.length; i += 300) {
    const { data } = await admin
      .from("clients")
      .select("mindbody_client_id, first_name, last_name")
      .eq("organization_id", organizationId)
      .in("mindbody_client_id", missing.slice(i, i + 300));
    for (const c of data ?? []) names.set(c.mindbody_client_id as string, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim());
  }

  // Pack balances for the clients involved: SynqIQ vs Mindbody's last sync.
  const balances: BalanceRow[] = [];
  for (let i = 0; i < clientIds.length; i += 300) {
    const { data: packs } = await admin
      .from("session_pack_balances")
      .select("id, mindbody_client_id, name, opening_remaining, remaining_since_sync, source, kind")
      .eq("organization_id", organizationId)
      .eq("source", "mindbody")
      .in("kind", ["pt", "intro"])
      .in("mindbody_client_id", clientIds.slice(i, i + 300));
    for (const pack of packs ?? []) {
      const synqiq = Number(pack.remaining_since_sync);
      const mbo = Number(pack.opening_remaining);
      balances.push({
        clientId: pack.mindbody_client_id as string,
        clientName: names.get(pack.mindbody_client_id as string) ?? "Client",
        pack: pack.name as string,
        synqiq,
        mindbody: mbo,
        usedInSynqiqSinceSync: mbo - synqiq,
      });
    }
  }

  const label = (r: ReconRow) => {
    const s = r.kind === "mindbody_only" ? r.mindbody : r.synq;
    return {
      trainer: (s.trainerId && trainerName.get(s.trainerId)) || "Trainer",
      client: names.get(s.clientId) || "Client",
    };
  };
  return {
    rows: rows.map((r) => ({ ...r, ...label(r) })),
    counts: {
      matched: rows.filter((r) => r.kind === "match" && !r.statusDiffers).length,
      statusDiffers: rows.filter((r) => r.kind === "match" && r.statusDiffers).length,
      synqOnly: rows.filter((r) => r.kind === "synq_only").length,
      mindbodyOnly: rows.filter((r) => r.kind === "mindbody_only").length,
    },
    balances: balances.sort((a, b) => a.clientName.localeCompare(b.clientName)),
  };
}
