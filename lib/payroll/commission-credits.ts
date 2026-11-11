import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeCommissions } from "@/lib/payroll/commission-job";
import { parseCommissionReport, type ReportLine } from "@/lib/payroll/mbo-commission-report";
import { syncMemberProfile } from "@/lib/sync/member-profile";

// Who earns commission on a sale line: set by a Club Admin, or imported from
// Mindbody's commission report during the parallel run. Changing credits
// drops that line's commission and figures it again.

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const norm = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

async function refigure(admin: Admin, organizationId: string, detailIds: number[], saleTimes: string[]) {
  if (detailIds.length === 0) return;
  for (let i = 0; i < detailIds.length; i += 300) {
    await admin
      .from("commission_lines")
      .delete()
      .eq("organization_id", organizationId)
      .eq("kind", "earn")
      .in("mindbody_sale_detail_id", detailIds.slice(i, i + 300));
  }
  const times = saleTimes.map((time) => Date.parse(time)).filter(Number.isFinite);
  if (times.length === 0) return;
  await computeCommissions(
    organizationId,
    new Date(Math.min(...times) - 1000).toISOString(),
    new Date(Math.max(...times) + 1000).toISOString(),
  );
}

export async function setLineCredits(
  organizationId: string,
  detailId: number,
  credits: { staffId: string; sharePercent: number }[],
  none: boolean,
  setBy: string,
) {
  const admin = createSupabaseAdminClient();
  const { data: item } = await admin
    .from("member_sale_items")
    .select("mindbody_sale_id")
    .eq("organization_id", organizationId)
    .eq("mindbody_sale_detail_id", detailId)
    .maybeSingle();
  if (!item) return "Sale line not found.";
  const total = credits.reduce((sum, credit) => sum + credit.sharePercent, 0);
  if (credits.some((credit) => !(credit.sharePercent > 0) || credit.sharePercent > 100) || total > 100.001)
    return "Shares must add up to 100% or less.";
  if (new Set(credits.map((credit) => credit.staffId)).size !== credits.length) return "Each person once.";
  const { data: people } = await admin
    .from("staff")
    .select("id")
    .eq("organization_id", organizationId)
    .in(
      "id",
      credits.map((credit) => credit.staffId),
    );
  if ((people ?? []).length !== credits.length) return "Person not found.";

  await admin.from("commission_sale_credits").delete().eq("organization_id", organizationId).eq("mindbody_sale_detail_id", detailId);
  if (!none && credits.length) {
    const { error } = await admin.from("commission_sale_credits").insert(
      credits.map((credit) => ({
        organization_id: organizationId,
        mindbody_sale_detail_id: detailId,
        staff_id: credit.staffId,
        share_percent: credit.sharePercent,
        source: "manual",
        set_by_staff_id: setBy,
      })),
    );
    if (error) return "Couldn't save. Try again.";
  }
  await admin.from("commission_sale_flags").upsert({
    organization_id: organizationId,
    mindbody_sale_detail_id: detailId,
    no_commission: none,
    set_at: new Date().toISOString(),
    set_by_staff_id: setBy,
  });
  const { data: sale } = await admin
    .from("member_sales")
    .select("sale_at")
    .eq("organization_id", organizationId)
    .eq("mindbody_sale_id", item.mindbody_sale_id)
    .maybeSingle();
  await refigure(admin, organizationId, [detailId], sale?.sale_at ? [sale.sale_at as string] : []);
  return null;
}

export type ImportResult = { lines: number; matched: number; credited: number; unmatched: string[]; skipped: number };

// Import Mindbody's commission report: each positive line is matched to the
// synced sale line (same client, same day, same item, same price) and the
// people Mindbody paid are credited, splitting the line evenly when two reps
// shared it. Returns and $0 lines are skipped (returns claw back on their own).
export async function importCommissionReport(organizationId: string, input: string, setBy: string): Promise<ImportResult> {
  const admin = createSupabaseAdminClient();
  const lines = parseCommissionReport(input);
  const usable = lines.filter((line) => line.priceCents > 0 && line.totalCents > 0);
  const result: ImportResult = { lines: lines.length, matched: 0, credited: 0, unmatched: [], skipped: lines.length - usable.length };
  if (usable.length === 0) return result;

  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const { data: staff } = await admin.from("staff").select("id, display_name, first_name, last_name").eq("organization_id", organizationId);
  const staffBy = new Map<string, string>();
  for (const person of staff ?? []) {
    staffBy.set(norm(person.display_name), person.id as string);
    staffBy.set(norm(`${person.first_name} ${person.last_name}`), person.id as string);
  }
  const clientIds = [...new Set(usable.map((line) => line.clientId))];
  const days = usable.map((line) => line.date).sort();
  const from = DateTime.fromISO(days[0], { zone }).minus({ days: 1 }).startOf("day").toUTC().toISO()!;
  const to = DateTime.fromISO(days[days.length - 1], { zone })
    .plus({ days: 2 })
    .startOf("day")
    .toUTC()
    .toISO()!;
  const loadSales = async () => {
    const found: { mindbody_sale_id: number; mindbody_client_id: string; sale_at: string }[] = [];
    for (let i = 0; i < clientIds.length; i += 300) {
      const { data } = await admin
        .from("member_sales")
        .select("mindbody_sale_id, mindbody_client_id, sale_at")
        .eq("organization_id", organizationId)
        .in("mindbody_client_id", clientIds.slice(i, i + 300))
        .gte("sale_at", from)
        .lt("sale_at", to);
      found.push(...((data ?? []) as typeof found));
    }
    return found;
  };
  let sales = await loadSales();
  // Clients whose purchases aren't synced yet (not members, or bought after
  // last night's sync): read them from Mindbody now (read-only) and retry.
  const missing = clientIds.filter((clientId) => !sales.some((sale) => sale.mindbody_client_id === clientId)).slice(0, 25);
  if (missing.length) {
    for (const clientId of missing) {
      await syncMemberProfile({ organizationId, mindbodyClientId: clientId }).catch(() => null);
    }
    sales = await loadSales();
  }
  const saleBy = new Map(sales.map((sale) => [Number(sale.mindbody_sale_id), sale]));
  const items: {
    mindbody_sale_id: number;
    mindbody_sale_detail_id: number;
    description: string;
    quantity: number | null;
    unit_price_cents: number | null;
    discount_cents: number | null;
    total_cents: number | null;
    tax_cents: number | null;
  }[] = [];
  const saleIds = [...saleBy.keys()];
  for (let i = 0; i < saleIds.length; i += 300) {
    const { data } = await admin
      .from("member_sale_items")
      .select("mindbody_sale_id, mindbody_sale_detail_id, description, quantity, unit_price_cents, discount_cents, total_cents, tax_cents")
      .eq("organization_id", organizationId)
      .in("mindbody_sale_id", saleIds.slice(i, i + 300));
    items.push(...((data ?? []) as typeof items));
  }
  const day = (iso: string) => DateTime.fromISO(iso).setZone(zone).toISODate();
  const price = (item: (typeof items)[number]) =>
    item.unit_price_cents != null
      ? Math.round(Number(item.unit_price_cents) * Number(item.quantity ?? 1) - Number(item.discount_cents ?? 0))
      : Number(item.total_cents ?? 0) - Number(item.tax_cents ?? 0);

  // detailId -> staff ids credited by the report
  const credited = new Map<number, Set<string>>();
  const describe = (line: ReportLine) => `${line.date} ${line.staffName}: ${line.item} $${(line.priceCents / 100).toFixed(2)}`;
  for (const line of usable) {
    const staffId = staffBy.get(norm(line.staffName));
    if (!staffId) {
      result.unmatched.push(`${describe(line)} (no SynqIQ staff named ${line.staffName})`);
      continue;
    }
    const candidates = items.filter((item) => {
      const sale = saleBy.get(Number(item.mindbody_sale_id));
      return (
        sale &&
        sale.mindbody_client_id === line.clientId &&
        (day(sale.sale_at) === line.date || String(sale.sale_at).slice(0, 10) === line.date) &&
        norm(item.description) === norm(line.item) &&
        Math.abs(price(item) - line.priceCents) <= 1
      );
    });
    const pick = candidates.find((item) => !credited.get(Number(item.mindbody_sale_detail_id))?.has(staffId));
    if (!pick) {
      result.unmatched.push(`${describe(line)} (no matching synced sale line yet)`);
      continue;
    }
    result.matched += 1;
    const set = credited.get(Number(pick.mindbody_sale_detail_id)) ?? new Set<string>();
    set.add(staffId);
    credited.set(Number(pick.mindbody_sale_detail_id), set);
  }

  const detailIds = [...credited.keys()];
  for (let i = 0; i < detailIds.length; i += 300) {
    await admin
      .from("commission_sale_credits")
      .delete()
      .eq("organization_id", organizationId)
      .in("mindbody_sale_detail_id", detailIds.slice(i, i + 300));
  }
  const rows = detailIds.flatMap((detailId) => {
    const people = [...credited.get(detailId)!];
    const share = Math.round((100 / people.length) * 100) / 100;
    return people.map((staffId) => ({
      organization_id: organizationId,
      mindbody_sale_detail_id: detailId,
      staff_id: staffId,
      share_percent: share,
      source: "import",
      set_by_staff_id: setBy,
    }));
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("commission_sale_credits").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  result.credited = detailIds.length;
  const saleTimes = detailIds.map((detailId) => {
    const item = items.find((candidate) => Number(candidate.mindbody_sale_detail_id) === detailId)!;
    return saleBy.get(Number(item.mindbody_sale_id))!.sale_at;
  });
  await refigure(admin, organizationId, detailIds, saleTimes);
  return result;
}
