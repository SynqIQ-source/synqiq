import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  byCategory,
  change,
  heatmap,
  maintenanceSummary,
  memberMovement,
  membersOn,
  periodsFor,
  sumCents,
  type Adjustment,
  type SaleLine,
  type Schedule,
} from "@/lib/dashboard/club-math";

// Club Overview (Club Admins): loads SynqIQ's own records and runs the
// numbers in lib/dashboard/club-math.ts. Before payments go live almost
// everything SynqIQ sells is "practice"; `includePractice` counts practice
// sales, memberships and autopays so the dashboard can be tested.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function pageAll<T>(fetchPage: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export type TodaySale = {
  id: string;
  number: number;
  time: string;
  client: string;
  staff: string;
  payment: string;
  status: string;
  totalCents: number;
  items: string;
};

export async function loadClubOverview(organizationId: string, options: { includePractice: boolean; now?: DateTime }) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const now = (options.now ?? DateTime.now()).setZone(zone);
  const periods = periodsFor(now.toISODate()!);
  const startUtc = (day: string) => DateTime.fromISO(day, { zone }).startOf("day").toUTC().toISO()!;
  const localDay = (iso: string) => DateTime.fromISO(iso).setZone(zone).toISODate()!;
  const include = options.includePractice;

  const [schedules, adjustments, sales, checkIns, guests, issues, practiceCharges] = await Promise.all([
    loadSchedules(admin, organizationId, localDay),
    loadAdjustments(admin, organizationId, localDay),
    loadSales(admin, organizationId, startUtc(periods.priorFrom), include),
    pageAll<{ local_date: string }>((from) =>
      admin
        .from("check_ins")
        .select("local_date")
        .eq("organization_id", organizationId)
        .is("voided_at", null)
        .gte("local_date", periods.priorFrom)
        .order("id")
        .range(from, from + 999),
    ),
    pageAll<{ visit_at: string }>((from) =>
      admin
        .from("guest_visits")
        .select("visit_at")
        .eq("organization_id", organizationId)
        .gte("visit_at", startUtc(periods.priorFrom))
        .order("id")
        .range(from, from + 999),
    ),
    pageAll<{ id: string; title: string; status: string; is_critical: boolean; created_at: string; resolved_at: string | null }>((from) =>
      admin
        .from("maintenance_issues")
        .select("id, title, status, is_critical, created_at, resolved_at")
        .eq("organization_id", organizationId)
        .is("resolved_at", null)
        .order("created_at")
        .range(from, from + 999),
    ),
    include
      ? pageAll<{ total_cents: number }>((from) =>
          admin
            .from("practice_charges")
            .select("total_cents")
            .eq("organization_id", organizationId)
            .eq("due_date", periods.today)
            .order("id")
            .range(from, from + 999),
        )
      : Promise.resolve([] as { total_cents: number }[]),
  ]);

  // Members
  const today = membersOn(schedules, adjustments, periods.today, include);
  const before = membersOn(schedules, adjustments, periods.thirtyDaysAgo, include);
  const movement = memberMovement(schedules, adjustments, periods.mtdFrom, periods.mtdTo, include);
  const names = await memberNames(admin, organizationId, schedules, [
    ...movement.sold.map((s) => s.clientId),
    ...movement.cancelled.map((a) => a.clientId),
    ...movement.frozen.map((a) => a.clientId),
    ...movement.unfrozen.map((a) => a.clientId),
  ]);
  const who = (clientId: string) => ({ client: clientId, person: names.get(clientId) ?? `Client ${clientId}` });

  // Sales
  const lines = sales.lines;
  const mtdLines = lines.filter((line) => line.day >= periods.mtdFrom && line.day <= periods.mtdTo);
  const priorLines = lines.filter((line) => line.day >= periods.priorFrom && line.day <= periods.priorTo);
  const todaysLines = lines.filter((line) => line.day === periods.today);

  // Check-ins and guests: same days of last month for the comparison.
  const checkInDays = checkIns.map((row) => row.local_date);
  const guestTimes = guests.map((row) => row.visit_at);
  const guestDays = guestTimes.map(localDay);
  const count = (days: string[], from: string, to: string) => days.filter((day) => day >= from && day <= to).length;
  const checkInsMtd = count(checkInDays, periods.mtdFrom, periods.mtdTo);
  const checkInsPrior = count(checkInDays, periods.priorFrom, periods.priorTo);
  const guestsMtd = count(guestDays, periods.mtdFrom, periods.mtdTo);
  const guestsPrior = count(guestDays, periods.priorFrom, periods.priorTo);
  const checkInsByDay = new Map<string, number>();
  for (const day of checkInDays) if (day >= periods.mtdFrom) checkInsByDay.set(day, (checkInsByDay.get(day) ?? 0) + 1);

  const autopayCents = practiceCharges.reduce((sum, row) => sum + Number(row.total_cents), 0);
  const posTodayCents = sumCents(todaysLines);

  return {
    zone,
    periods,
    includePractice: include,
    members: {
      active: today.active.size,
      frozen: today.frozen.size,
      vs30: change(today.active.size, before.active.size),
      movement: {
        sold: movement.sold.map((s) => ({ ...who(s.clientId), membership: s.membership, day: s.createdDay })),
        cancelled: movement.cancelled.map((a) => ({ ...who(a.clientId), day: a.createdDay, effective: a.startsOn })),
        frozen: movement.frozen.map((a) => ({ ...who(a.clientId), from: a.startsOn, to: a.endsOn })),
        unfrozen: movement.unfrozen.map((a) => ({
          ...who(a.clientId),
          day: a.cancelledDay ?? (a.endsOn ? DateTime.fromISO(a.endsOn).plus({ days: 1 }).toISODate()! : ""),
        })),
        net: movement.net,
      },
    },
    sales: {
      mtdCents: sumCents(mtdLines),
      priorCents: sumCents(priorLines),
      vsPrior: change(sumCents(mtdLines), sumCents(priorLines)),
      byCategory: byCategory(mtdLines),
      today: sales.todaySales(periods.today),
    },
    revenueToday: { posCents: posTodayCents, autopayCents, totalCents: posTodayCents + autopayCents },
    checkIns: {
      mtd: checkInsMtd,
      prior: checkInsPrior,
      vsPrior: change(checkInsMtd, checkInsPrior),
      byDay: [...checkInsByDay.entries()].sort(),
    },
    guests: {
      mtd: guestsMtd,
      prior: guestsPrior,
      vsPrior: change(guestsMtd, guestsPrior),
      heat: heatmap(
        guestTimes.filter((iso) => localDay(iso) >= periods.mtdFrom),
        zone,
      ),
    },
    maintenance: {
      ...maintenanceSummary(
        issues.map((issue) => ({ status: issue.status, createdAt: issue.created_at, resolvedAt: issue.resolved_at })),
        now,
      ),
      open: issues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        critical: issue.is_critical,
        days: Math.floor(Math.max(0, now.diff(DateTime.fromISO(issue.created_at), "days").days)),
      })),
    },
  };
}

export type ClubOverview = Awaited<ReturnType<typeof loadClubOverview>>;

// Names for the people in the member lists: the name on their SynqIQ
// membership, else their SynqIQ member profile.
async function memberNames(admin: Admin, organizationId: string, schedules: Schedule[], clientIds: string[]) {
  const names = new Map<string, string>();
  for (const schedule of schedules) if (schedule.name) names.set(schedule.clientId, schedule.name);
  const missing = [...new Set(clientIds)].filter((id) => !names.has(id));
  for (let index = 0; index < missing.length; index += 200) {
    const { data } = await admin
      .from("member_personal")
      .select("mindbody_client_id, mindbody")
      .eq("organization_id", organizationId)
      .in("mindbody_client_id", missing.slice(index, index + 200));
    for (const row of data ?? []) {
      const profile = (row.mindbody ?? {}) as { firstName?: string; lastName?: string };
      const name = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
      if (name) names.set(row.mindbody_client_id as string, name);
    }
  }
  return names;
}

async function loadSchedules(admin: Admin, organizationId: string, localDay: (iso: string) => string): Promise<Schedule[]> {
  const rows = await pageAll<{
    id: string;
    mindbody_client_id: string;
    client_name: string | null;
    name: string;
    status: string;
    start_date: string;
    end_date: string | null;
    created_at: string;
    voided_at: string | null;
  }>((from) =>
    admin
      .from("member_billing_schedules")
      .select("id, mindbody_client_id, client_name, name, status, start_date, end_date, created_at, voided_at")
      .eq("organization_id", organizationId)
      .order("id")
      .range(from, from + 999),
  );
  return rows.map((row) => ({
    id: row.id,
    clientId: row.mindbody_client_id,
    name: row.client_name ?? "",
    membership: row.name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdDay: localDay(row.created_at),
    voided: Boolean(row.voided_at) || row.status === "voided",
  }));
}

async function loadAdjustments(admin: Admin, organizationId: string, localDay: (iso: string) => string): Promise<Adjustment[]> {
  const rows = await pageAll<{
    id: string;
    mindbody_client_id: string;
    kind: string;
    starts_on: string;
    ends_on: string | null;
    created_at: string;
    cancelled_at: string | null;
  }>((from) =>
    admin
      .from("billing_adjustments")
      .select("id, mindbody_client_id, kind, starts_on, ends_on, created_at, cancelled_at")
      .eq("organization_id", organizationId)
      .in("kind", ["freeze", "cancel"])
      .order("id")
      .range(from, from + 999),
  );
  return rows.map((row) => ({
    id: row.id,
    clientId: row.mindbody_client_id,
    kind: row.kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdDay: localDay(row.created_at),
    cancelledDay: row.cancelled_at ? localDay(row.cancelled_at) : null,
  }));
}

// Checkout sales since `sinceUtc`: completed ones (and practice ones when
// asked), never voided. Lines carry their revenue category (membership
// packages are already split into their parts, e.g. registration + dues).
async function loadSales(admin: Admin, organizationId: string, sinceUtc: string, includePractice: boolean) {
  const statuses = includePractice ? ["completed", "practice"] : ["completed"];
  const sales = await pageAll<{
    id: string;
    sale_number: number;
    status: string;
    client_name: string | null;
    staff_id: string;
    payment_method: string;
    total_cents: number;
    created_at: string;
  }>((from) =>
    admin
      .from("pos_sales")
      .select("id, sale_number, status, client_name, staff_id, payment_method, total_cents, created_at")
      .eq("organization_id", organizationId)
      .in("status", statuses)
      .is("voided_at", null)
      .gte("created_at", sinceUtc)
      .order("created_at")
      .range(from, from + 999),
  );
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const dayOf = new Map(sales.map((sale) => [sale.id, DateTime.fromISO(sale.created_at).setZone(zone).toISODate()!]));
  const lineRows: { sale_id: string; name: string; quantity: number; revenue_category: string | null; total_cents: number }[] = [];
  const ids = sales.map((sale) => sale.id);
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await admin
      .from("pos_sale_lines")
      .select("sale_id, name, quantity, revenue_category, total_cents")
      .in("sale_id", ids.slice(index, index + 200));
    if (error) throw new Error(error.message);
    lineRows.push(...((data ?? []) as typeof lineRows));
  }
  const lines: SaleLine[] = lineRows.map((row) => ({
    saleId: row.sale_id,
    day: dayOf.get(row.sale_id) ?? "",
    category: row.revenue_category ?? "Uncategorized",
    totalCents: Number(row.total_cents),
  }));
  const staffIds = [...new Set(sales.map((sale) => sale.staff_id))];
  const { data: staffRows } = staffIds.length
    ? await admin.from("staff").select("id, display_name").in("id", staffIds)
    : { data: [] as { id: string; display_name: string }[] };
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  const linesBySale = new Map<string, string[]>();
  for (const row of lineRows) {
    const list = linesBySale.get(row.sale_id) ?? [];
    list.push(row.quantity > 1 ? `${row.quantity} × ${row.name}` : row.name);
    linesBySale.set(row.sale_id, list);
  }
  const todaySales = (today: string): TodaySale[] =>
    sales
      .filter((sale) => dayOf.get(sale.id) === today)
      .reverse()
      .map((sale) => ({
        id: sale.id,
        number: Number(sale.sale_number),
        time: DateTime.fromISO(sale.created_at).setZone(zone).toFormat("h:mm a"),
        client: sale.client_name ?? "Walk-in",
        staff: sale.staff_id ? (staffName.get(sale.staff_id) ?? "—") : "Automatic renewal",
        payment: sale.payment_method,
        status: sale.status,
        totalCents: Number(sale.total_cents),
        items: (linesBySale.get(sale.id) ?? []).join(", "),
      }));
  return { lines, todaySales };
}
