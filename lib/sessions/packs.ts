import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCountedPack, packKind, refreshesFromMindbody, packUseKind, type PackForBooking, type PackKind } from "@/lib/sessions/packs-rules";

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
export async function memberPacks(
  admin: Admin,
  organizationId: string,
  clientId: string,
): Promise<(PackForBooking & { total: number; source: string })[]> {
  const { data: packs } = await admin
    .from("session_pack_balances")
    .select("id, name, kind, remaining, total_sessions, expires_on, source")
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
    remaining: Number(pack.remaining),
    reserved: reserved.get(pack.id as string) ?? 0,
    expiresOn: (pack.expires_on as string | null)?.slice(0, 10) ?? null,
    total: Number(pack.total_sessions),
    source: pack.source as string,
  }));
}

// A closed session takes its session from the pack (completed, no-show, late
// cancel); an on-time cancel takes none. One live use per session.
export async function recordSessionUse(
  admin: Admin,
  organizationId: string,
  sessionId: string,
  packId: string | null,
  status: string,
  staffId: string,
) {
  const kind = packUseKind(status);
  if (!packId || !kind) return;
  const { error } = await admin.from("session_pack_uses").insert({
    organization_id: organizationId,
    session_pack_id: packId,
    trainer_session_id: sessionId,
    kind,
    sessions: -1,
    staff_id: staffId,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

// Reopening a session gives its session back.
export async function voidSessionUse(admin: Admin, sessionId: string, staffId: string) {
  await admin
    .from("session_pack_uses")
    .update({ voided_at: new Date().toISOString(), voided_by_staff_id: staffId })
    .eq("trainer_session_id", sessionId)
    .is("voided_at", null);
}

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
  const { error } = await admin.from("session_packs").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}
