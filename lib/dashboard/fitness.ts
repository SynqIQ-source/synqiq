import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { periodsFor } from "@/lib/dashboard/club-math";
import {
  perTrainer,
  percentOf,
  projectMonth,
  ptSales,
  sessionsByDay,
  sessionsInItem,
  trainerAverages,
  isScheduled,
  type PtLine,
  type Seller,
  type TrainerSession,
} from "@/lib/dashboard/fitness-math";

// Fitness Dashboard (Club Admins): loads SynqIQ's own personal-training
// records -- trainer sessions booked in SynqIQ and PT sold at SynqIQ's
// checkout -- and runs the numbers in lib/dashboard/fitness-math.ts. Before
// payments go live almost every SynqIQ sale is "practice"; `includePractice`
// counts them so the dashboard can be tried out.

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

export type FitnessGoals = { month: string; fromMonth: string | null; sessions: number | null; salesCents: number | null };

export async function loadFitnessGoals(admin: Admin, organizationId: string, month: string): Promise<FitnessGoals> {
  const { data } = await admin
    .from("fitness_goals")
    .select("month, sessions_goal, sales_goal_cents")
    .eq("organization_id", organizationId)
    .lte("month", month)
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    month,
    fromMonth: (data?.month as string | undefined) ?? null,
    sessions: data?.sessions_goal == null ? null : Number(data.sessions_goal),
    salesCents: data?.sales_goal_cents == null ? null : Number(data.sales_goal_cents),
  };
}

export async function loadFitnessDashboard(organizationId: string, options: { includePractice: boolean; now?: DateTime }) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("timezone, crm_intro_session_type_id")
    .eq("id", organizationId)
    .maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const introTypeId = (org?.crm_intro_session_type_id as number | null) ?? null;
  const now = (options.now ?? DateTime.now()).setZone(zone);
  const periods = periodsFor(now.toISODate()!);
  const weekEnd = now.plus({ days: 6 }).toISODate()!;
  const month = now.startOf("month").toISODate()!;

  const [staffRows, sessionRows, lines, goals] = await Promise.all([
    pageAll<{ id: string; display_name: string | null; role: string; is_trainer: boolean | null; archived_at: string | null }>((from) =>
      admin
        .from("staff")
        .select("id, display_name, role, is_trainer, archived_at")
        .eq("organization_id", organizationId)
        .order("id")
        .range(from, from + 999),
    ),
    pageAll<{
      id: string;
      trainer_staff_id: string;
      mindbody_client_id: string;
      client_name: string;
      session_type_id: number | null;
      session_type_name: string;
      starts_at: string;
      local_date: string;
      status: string;
    }>((from) =>
      admin
        .from("trainer_sessions")
        .select("id, trainer_staff_id, mindbody_client_id, client_name, session_type_id, session_type_name, starts_at, local_date, status")
        .eq("organization_id", organizationId)
        .gte("local_date", periods.mtdFrom)
        .lte("local_date", weekEnd)
        .order("id")
        .range(from, from + 999),
    ),
    loadPtLines(admin, organizationId, zone, periods.mtdFrom, options.includePractice),
    loadFitnessGoals(admin, organizationId, month),
  ]);

  const sellers = new Map<string, Seller>(
    staffRows.map((row) => [row.id, { id: row.id, name: row.display_name ?? "Staff", role: row.role, isTrainer: Boolean(row.is_trainer) }]),
  );
  const trainers = new Map([...sellers].filter(([, seller]) => seller.isTrainer));
  const sessions: TrainerSession[] = sessionRows.map((row) => ({
    id: row.id,
    trainerId: row.trainer_staff_id,
    client: row.client_name,
    clientId: row.mindbody_client_id,
    type: row.session_type_name,
    typeId: row.session_type_id,
    day: row.local_date,
    startsAt: row.starts_at,
    status: row.status,
  }));
  const mtdSessions = sessions.filter((session) => session.day <= periods.today);

  const sales = ptSales(lines, sellers);
  const days = sessionsByDay(mtdSessions, periods.mtdFrom, periods.today);
  const scheduled = days.reduce((sum, row) => sum + row.scheduled, 0);
  const completed = days.reduce((sum, row) => sum + row.completed, 0);

  const isIntro = (session: TrainerSession) => (introTypeId != null && session.typeId === introTypeId) || /intro/i.test(session.type);
  const intros = sessions
    .filter((session) => session.day >= periods.today && session.day <= weekEnd && isIntro(session) && session.status === "booked")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((session) => ({
      ...session,
      trainer: sellers.get(session.trainerId)?.name ?? "—",
      time: DateTime.fromISO(session.startsAt).setZone(zone).toFormat("ccc LLL d · h:mm a"),
    }));

  const trainerRows = perTrainer(mtdSessions, sales, trainers);
  const sessionsPace = projectMonth(completed, periods.today);
  const salesPace = projectMonth(sales.totalCents, periods.today);

  return {
    periods,
    weekEnd,
    includePractice: options.includePractice,
    sales: { ...sales, lines },
    sessions: { scheduled, completed, percent: percentOf(completed, scheduled), days },
    intros,
    goals: {
      month: goals.month,
      fromMonth: goals.fromMonth,
      sessions: { actual: completed, goal: goals.sessions, ...sessionsPace },
      sales: { actual: sales.totalCents, goal: goals.salesCents, ...salesPace },
    },
    trainers: { rows: trainerRows, averages: trainerAverages(trainerRows) },
    upcomingScheduled: sessions.filter((session) => session.day > periods.today && isScheduled(session.status)).length,
  };
}

export type FitnessDashboard = Awaited<ReturnType<typeof loadFitnessDashboard>>;

// Personal-training lines sold at checkout since `fromDay`: lines in a
// revenue category named like "Personal Training", before tax.
async function loadPtLines(admin: Admin, organizationId: string, zone: string, fromDay: string, includePractice: boolean) {
  const { data: categories } = await admin
    .from("revenue_categories")
    .select("id, name")
    .eq("organization_id", organizationId)
    .ilike("name", "%training%");
  const categoryIds = (categories ?? []).map((row) => row.id as string);
  if (!categoryIds.length) return [] as PtLine[];
  const sinceUtc = DateTime.fromISO(fromDay, { zone }).startOf("day").toUTC().toISO()!;
  const sales = await pageAll<{ id: string; sale_number: number; client_name: string | null; staff_id: string; created_at: string }>(
    (from) =>
      admin
        .from("pos_sales")
        .select("id, sale_number, client_name, staff_id, created_at")
        .eq("organization_id", organizationId)
        .in("status", includePractice ? ["completed", "practice"] : ["completed"])
        .is("voided_at", null)
        .gte("created_at", sinceUtc)
        .order("created_at")
        .range(from, from + 999),
  );
  const saleBy = new Map(sales.map((sale) => [sale.id, sale]));
  const rows: {
    id: string;
    sale_id: string;
    pos_item_id: string | null;
    name: string;
    quantity: number;
    tax_cents: number;
    total_cents: number;
    commission_credits: { staffId: string; share: number }[] | null;
  }[] = [];
  const ids = sales.map((sale) => sale.id);
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await admin
      .from("pos_sale_lines")
      .select("id, sale_id, pos_item_id, name, quantity, tax_cents, total_cents, commission_credits")
      .in("sale_id", ids.slice(index, index + 200))
      .in("revenue_category_id", categoryIds);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
  }
  const itemIds = [...new Set(rows.map((row) => row.pos_item_id).filter((id): id is string => Boolean(id)))];
  const { data: items } = itemIds.length
    ? await admin.from("pos_items").select("id, sessions").in("id", itemIds)
    : { data: [] as { id: string; sessions: number | null }[] };
  const sessionsBy = new Map((items ?? []).map((item) => [item.id as string, (item.sessions as number | null) ?? null]));
  return rows
    .map((row): PtLine => {
      const sale = saleBy.get(row.sale_id)!;
      return {
        lineId: row.id,
        saleNumber: Number(sale.sale_number),
        day: DateTime.fromISO(sale.created_at).setZone(zone).toISODate()!,
        client: sale.client_name ?? "Walk-in",
        name: row.name,
        quantity: Number(row.quantity),
        amountCents: Number(row.total_cents) - Number(row.tax_cents),
        sessions: sessionsInItem(row.name, row.pos_item_id ? (sessionsBy.get(row.pos_item_id) ?? null) : null),
        rangUpBy: sale.staff_id,
        credits: (row.commission_credits ?? []).map((credit) => ({ staffId: String(credit.staffId), share: Number(credit.share ?? 100) })),
      };
    })
    .sort((a, b) => b.day.localeCompare(a.day) || b.saleNumber - a.saleNumber);
}
