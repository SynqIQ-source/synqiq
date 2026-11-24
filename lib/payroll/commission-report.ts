import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rangeInstants } from "@/lib/payroll/period";

// One row per commission line earned in a range (the same lines Payroll
// totals): the sale, the client, what was bought, the rate and the earning,
// plus a note when a Club Admin changed who earns on that sale (split credit,
// "no commission", or an approved trainer handoff), with who and when.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type CommissionReportRow = {
  id: string;
  staffId: string;
  staffName: string;
  saleAt: string;
  client: string;
  item: string;
  category: string;
  condition: string;
  clawback: boolean;
  quantity: number;
  baseCents: number;
  rate: string; // "10%", "$25 flat", with the person's share when split
  amountCents: number;
  adminNote: string | null;
};

const chunk = <T>(list: T[], size = 300) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export async function loadCommissionReport(admin: Admin, organizationId: string, from: string, to: string, timezone: string) {
  const { startIso, endIso } = rangeInstants(from, to, timezone);
  const lines: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin
      .from("commission_lines")
      .select(
        "id, staff_id, kind, mindbody_sale_detail_id, mindbody_client_id, sale_at, earned_at, description, category, condition, quantity, base_cents, percent, flat_cents, share_percent, amount_cents",
      )
      .eq("organization_id", organizationId)
      .gte("earned_at", startIso)
      .lt("earned_at", endIso)
      .order("earned_at")
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    lines.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const detailIds = [...new Set(lines.map((line) => Number(line.mindbody_sale_detail_id)))];
  const clientIds = [...new Set(lines.map((line) => String(line.mindbody_client_id ?? "")).filter((id) => /^\d+$/.test(id)))]
    .map(Number)
    .filter((id) => id < 2_147_483_647);
  const [{ data: staff }, credits, flags, clients] = await Promise.all([
    admin.from("staff").select("id, display_name").eq("organization_id", organizationId),
    Promise.all(
      chunk(detailIds).map((ids) =>
        admin
          .from("commission_sale_credits")
          .select("mindbody_sale_detail_id, staff_id, share_percent, source, set_by_staff_id, created_at")
          .eq("organization_id", organizationId)
          .in("mindbody_sale_detail_id", ids),
      ),
    ).then((parts) => parts.flatMap((part) => part.data ?? [])),
    Promise.all(
      chunk(detailIds).map((ids) =>
        admin
          .from("commission_sale_flags")
          .select("mindbody_sale_detail_id, handoff_approved, no_commission, note, set_by_staff_id, set_at")
          .eq("organization_id", organizationId)
          .in("mindbody_sale_detail_id", ids),
      ),
    ).then((parts) => parts.flatMap((part) => part.data ?? [])),
    Promise.all(
      chunk(clientIds).map((ids) =>
        admin.from("clients").select("mindbody_unique_id, first_name, last_name").eq("organization_id", organizationId).in("mindbody_unique_id", ids),
      ),
    ).then((parts) => parts.flatMap((part) => part.data ?? [])),
  ]);
  const nameOf = new Map((staff ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const clientOf = new Map(clients.map((row) => [String(row.mindbody_unique_id), `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  const when = (iso: unknown) => DateTime.fromISO(String(iso)).setZone(timezone).toFormat("LLL d, h:mm a");

  const notes = new Map<number, string[]>();
  const addNote = (detailId: number, note: string) => notes.set(detailId, [...(notes.get(detailId) ?? []), note]);
  // A manual credit = a Club Admin chose who earns (one note per sale, latest change).
  const manual = new Map<number, Record<string, unknown>[]>();
  for (const credit of credits.filter((row) => row.source === "manual")) {
    const id = Number(credit.mindbody_sale_detail_id);
    manual.set(id, [...(manual.get(id) ?? []), credit]);
  }
  for (const [id, list] of manual) {
    const latest = list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const split = list.length > 1 ? `split ${list.map((c) => `${nameOf.get(c.staff_id as string) ?? "?"} ${Number(c.share_percent)}%`).join(" / ")}` : `credited to ${nameOf.get(list[0].staff_id as string) ?? "?"}`;
    addNote(id, `Changed by ${nameOf.get(latest.set_by_staff_id as string) ?? "a Club Admin"} on ${when(latest.created_at)}: ${split}`);
  }
  for (const flag of flags) {
    const id = Number(flag.mindbody_sale_detail_id);
    const by = `${nameOf.get(flag.set_by_staff_id as string) ?? "a Club Admin"} on ${when(flag.set_at)}`;
    if (flag.no_commission) addNote(id, `Set to no commission by ${by}`);
    else if (flag.handoff_approved) addNote(id, `Trainer handoff approved by ${by}`);
    if (flag.note) addNote(id, `Note: ${flag.note}`);
  }

  const rows: CommissionReportRow[] = lines.map((line) => {
    const share = Number(line.share_percent ?? 100);
    const base = line.percent != null ? `${Number(line.percent)}%` : line.flat_cents != null ? `$${(Number(line.flat_cents) / 100).toFixed(2)} flat` : "—";
    return {
      id: line.id as string,
      staffId: line.staff_id as string,
      staffName: nameOf.get(line.staff_id as string) ?? "Unknown",
      saleAt: line.sale_at as string,
      client: clientOf.get(String(line.mindbody_client_id ?? "")) || "—",
      item: line.description as string,
      category: line.category as string,
      condition: line.condition as string,
      clawback: line.kind === "clawback",
      quantity: Number(line.quantity ?? 1),
      baseCents: Number(line.base_cents),
      rate: share !== 100 ? `${base} × ${share}% share` : base,
      amountCents: Number(line.amount_cents),
      adminNote: notes.get(Number(line.mindbody_sale_detail_id))?.join(" · ") ?? null,
    };
  });
  return rows;
}
