import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isCountedPack,
  packKind,
  refreshesFromMindbody,
  packUseKind,
  type PackForBooking,
  type PackKind,
} from "@/lib/sessions/packs-rules";
import { sessionValueCents } from "@/lib/trainer/pilot-rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Prepaid session packs in SynqIQ (migration 20261120210000). Read the
// Mindbody balances in; never write to Mindbody.

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

// Nightly until the studio's switch date: every counted Mindbody pack (not
// unlimited access, not returned) becomes or refreshes a SynqIQ pack. Its
// opening balance follows Mindbody's remaining; sessions used in SynqIQ are
// taken off on top. After the switch nothing changes here.
export async function importMindbodyPacks(organizationId: string, now = new Date()) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone, session_balances_from").eq("id", organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.fromJSDate(now).setZone(zone).toISODate()!;
  const switchDate = ((org?.session_balances_from as string | null) ?? "2026-12-18").slice(0, 10);
  if (!refreshesFromMindbody(today, switchDate)) return { skipped: "SynqIQ owns session balances now" };

  const services = await all((a, b) =>
    admin
      .from("member_services")
      .select("mindbody_client_service_id, mindbody_client_id, name, program, count, remaining, expiration_date, returned")
      .eq("organization_id", organizationId)
      .order("id")
      .range(a, b),
  );
  const rows = services
    .filter((row) => isCountedPack(row.count == null ? null : Number(row.count)) && !row.returned && row.mindbody_client_service_id)
    .map((row) => ({
      organization_id: organizationId,
      mindbody_client_id: String(row.mindbody_client_id),
      name: (row.name as string | null) ?? "Session pack",
      kind: packKind((row.name as string | null) ?? "", (row.program as string | null) ?? null),
      program: (row.program as string | null) ?? null,
      total_sessions: Number(row.count),
      opening_remaining: Math.max(0, Number(row.remaining ?? 0)),
      expires_on: (row.expiration_date as string | null)?.slice(0, 10) ?? null,
      source: "mindbody",
      mindbody_client_service_id: String(row.mindbody_client_service_id),
      refreshed_at: now.toISOString(),
    }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("session_packs")
      .upsert(rows.slice(i, i + 500), { onConflict: "organization_id,mindbody_client_service_id" });
    if (error) throw new Error(error.message);
  }
  return { packs: rows.length };
}

// A member's packs with what's left and what's already booked against them.
//
// sinceSync (the trainer sessions pilot, while Mindbody is still the record
// and trainers log sessions there too): a Mindbody pack's balance is its last
// synced Mindbody balance plus SynqIQ entries made after that sync, so a
// session logged in both systems isn't taken twice.
export async function memberPacks(
  admin: Admin,
  organizationId: string,
  clientId: string,
  options: { sinceSync?: boolean } = {},
): Promise<(PackForBooking & { total: number; source: string })[]> {
  const { data: packs } = await admin
    .from("session_pack_balances")
    .select("id, name, kind, remaining, remaining_since_sync, total_sessions, expires_on, source")
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId)
    .order("expires_on", { ascending: true, nullsFirst: false });
  if (!packs?.length) return [];
  const { data: booked } = await admin
    .from("trainer_sessions")
    .select("session_pack_id")
    .eq("organization_id", organizationId)
    .eq("status", "booked")
    .in(
      "session_pack_id",
      packs.map((pack) => pack.id as string),
    );
  const reserved = new Map<string, number>();
  for (const row of booked ?? []) reserved.set(row.session_pack_id as string, (reserved.get(row.session_pack_id as string) ?? 0) + 1);
  return packs.map((pack) => ({
    id: pack.id as string,
    name: pack.name as string,
    kind: pack.kind as PackKind,
    remaining: Number(options.sinceSync && pack.source === "mindbody" ? pack.remaining_since_sync : pack.remaining),
    reserved: reserved.get(pack.id as string) ?? 0,
    expiresOn: (pack.expires_on as string | null)?.slice(0, 10) ?? null,
    total: Number(pack.total_sessions),
    source: pack.source as string,
  }));
}

// A closed session takes its session from the pack (completed, no-show, late
// cancel); an on-time cancel takes none. One charge per close-out (close_no):
// a retry hits the unique index and is ignored. Corrections add a reversal
// (lib/trainer/pilot.ts reverseCloseOut); nothing is voided or deleted.
export async function recordSessionUse(
  admin: Admin,
  organizationId: string,
  sessionId: string,
  packId: string | null,
  status: string,
  staffId: string,
  closeNo: number,
) {
  const kind = packUseKind(status);
  if (!packId || !kind) return;
  if (kind !== "completed") {
    const { data: rules } = await admin
      .from("organizations")
      .select("pt_no_show_uses_session, pt_late_cancel_uses_session")
      .eq("id", organizationId)
      .maybeSingle();
    if (kind === "no_show" && rules?.pt_no_show_uses_session === false) return;
    if (kind === "late_cancel" && rules?.pt_late_cancel_uses_session === false) return;
  }
  const { error } = await admin.from("session_pack_uses").insert({
    organization_id: organizationId,
    session_pack_id: packId,
    trainer_session_id: sessionId,
    close_no: closeNo,
    kind,
    sessions: -1,
    staff_id: staffId,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

// Reopening a session gives its session back.
// A session pack sold at SynqIQ's POS (an item with a session count) becomes
// a pack for the buyer.
export async function createSoldPacks(
  admin: Admin,
  input: {
    organizationId: string;
    saleId: string;
    mindbodyClientId: string | null;
    crmContactId: string | null;
    lines: { itemId: string; name: string; sessions: number | null; quantity: number; program: string | null }[];
  },
) {
  const rows = input.lines
    .filter((line) => line.sessions != null && isCountedPack(line.sessions))
    .map((line) => ({
      organization_id: input.organizationId,
      mindbody_client_id: input.mindbodyClientId,
      crm_contact_id: input.crmContactId,
      name: line.name,
      kind: packKind(line.name, line.program),
      program: line.program,
      total_sessions: line.sessions! * line.quantity,
      opening_remaining: line.sessions! * line.quantity,
      source: "synqiq",
      pos_sale_id: input.saleId,
      pos_item_id: line.itemId,
    }));
  if (!rows.length || (!input.mindbodyClientId && !input.crmContactId)) return 0;
  // What one session is worth (pre-tax paid / sessions): the base for
  // trainers paid a percent of the session's value.
  const { data: saleLines } = await admin
    .from("pos_sale_lines")
    .select("pos_item_id, total_cents, tax_cents")
    .eq("sale_id", input.saleId)
    .in(
      "pos_item_id",
      rows.map((row) => row.pos_item_id),
    );
  const valued = rows.map((row) => ({
    ...row,
    session_value_cents: sessionValueCents(
      (saleLines ?? [])
        .filter((line) => line.pos_item_id === row.pos_item_id)
        .map((line) => ({ totalCents: Number(line.total_cents), taxCents: Number(line.tax_cents) })),
      row.total_sessions,
    ),
  }));
  const { error } = await admin.from("session_packs").insert(valued);
  if (error) throw new Error(error.message);
  return rows.length;
}

// A voided sale's session packs: removed when no session was used from them;
// a used pack stays (staff adjust it by hand).
export async function removeSoldPacks(admin: Admin, organizationId: string, saleId: string) {
  const { data: packs } = await admin.from("session_packs").select("id").eq("organization_id", organizationId).eq("pos_sale_id", saleId);
  let removed = 0;
  let kept = 0;
  for (const pack of packs ?? []) {
    const { count } = await admin
      .from("session_pack_uses")
      .select("id", { count: "exact", head: true })
      .eq("session_pack_id", pack.id)
      .is("voided_at", null);
    const { count: booked } = await admin
      .from("trainer_sessions")
      .select("id", { count: "exact", head: true })
      .eq("session_pack_id", pack.id)
      .eq("status", "booked");
    if (count || booked) {
      kept += 1;
      continue;
    }
    await admin.from("session_packs").delete().eq("id", pack.id);
    removed += 1;
  }
  return { removed, kept };
}
