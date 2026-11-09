import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { loadItemClassifier } from "@/lib/mindbody/item-types";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { TrainerHealthTable } from "./trainer-health-table";
import { requireModule } from "@/lib/modules";
import { requireAccess } from "@/lib/require-access";
import { isTrainerAccess } from "@/lib/permissions";

const MONTHS_SHOWN = 6;
const PAGE_SIZE = 1000;
// Ratio below this for 2+ consecutive months is the early-warning flag the
// user asked for -- not configurable (unlike expected_revenue_per_session,
// which is the actual dollar benchmark), since the "how many consecutive
// months" question wasn't part of what was asked to be adjustable.
const HEALTH_THRESHOLD = 0.8;
const CONSECUTIVE_MONTHS_TO_FLAG = 2;

type StaffRow = { id: string; display_name: string };
type AppointmentRow = { staff_id: string | null; status: string; start_datetime: string; client_id: string | null };
type SaleRow = { sales_rep_staff_id: string | null; sale_datetime: string; total_amount: number };

async function getOrg(supabase: ScopedSupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("organizations")
    .select("timezone, expected_revenue_per_session")
    .eq("id", organizationId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to load organization.");
  }

  return data;
}

// Staff tagged Trainer (any role -- a club admin can train too).
async function getInstructors(supabase: ScopedSupabaseClient): Promise<StaffRow[]> {
  const { data, error } = await supabase.from("staff").select("id, display_name").eq("is_trainer", true);

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return data ?? [];
}

// Same 1000-row PostgREST page cap and .range() pagination loop as the
// Instructors page's getOccurrences -- both new tables can plausibly exceed
// that in a 6-month window (appointments especially: ~2,248 total in the
// sandbox's whole history).
async function getCompletedAppointments(
  supabase: ScopedSupabaseClient,
  windowStartIso: string,
): Promise<AppointmentRow[]> {
  const allRows: AppointmentRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("appointment_occurrences")
      .select("staff_id, status, start_datetime, client_id")
      .eq("status", "Completed")
      .gte("start_datetime", windowStartIso)
      // A stable order, or pages overlap and skip rows once there are
      // several pages (October showed 279 of 898 sessions).
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<AppointmentRow[]>();

    if (error) {
      throw new Error(`Failed to load appointments: ${error.message}`);
    }

    allRows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// A PT package's sale is credited, whole, to the trainer who completed the
// most sessions with that client in the 90 days after it was sold (a tie
// goes to whoever trained them first), in the month it was sold. PT means a
// sale line whose item is ticked as PT on Settings -> Mindbody items. Sales
// with no completed sessions yet aren't credited to anyone.
//
// A sale whose Mindbody sales rep is on the sales team (staff who can sell)
// was sold by that salesperson, so no trainer is credited -- standing in for
// "commission assigned" until Synq can read Mindbody's payroll commissions.
const PT_CREDIT_DAYS = 90;

async function getPtSales(
  supabase: ScopedSupabaseClient,
  organizationId: string,
  windowStartIso: string,
  appointments: AppointmentRow[],
): Promise<{ credited: SaleRow[]; uncredited: number; soldBySales: number }> {
  const isPt = await loadItemClassifier(supabase, organizationId, "sale_item");
  const { data: names, error: namesError } = await supabase
    .from("mindbody_item_types")
    .select("name")
    .eq("organization_id", organizationId)
    .eq("kind", "sale_item");
  if (namesError) throw new Error(`Failed to load item types: ${namesError.message}`);
  const ptNames = (names ?? []).map((row) => row.name as string).filter((name) => isPt(name));
  if (ptNames.length === 0) return { credited: [], uncredited: 0, soldBySales: 0 };
  const { data: sellers, error: sellersError } = await supabase.from("staff").select("id").eq("can_sell", true);
  if (sellersError) throw new Error(`Failed to load the sales team: ${sellersError.message}`);
  const salesTeam = new Set((sellers ?? []).map((row) => row.id as string));

  // PT lines, then the sales they belong to (in the window).
  const lines: { mindbody_sale_id: number; total_amount: number }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("sale_items")
      .select("mindbody_sale_id, total_amount")
      .in("description", ptNames)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load sale items: ${error.message}`);
    lines.push(...((data ?? []) as typeof lines));
    if (!data || data.length < PAGE_SIZE) break;
  }
  const ptAmount = new Map<number, number>();
  for (const line of lines) ptAmount.set(line.mindbody_sale_id, (ptAmount.get(line.mindbody_sale_id) ?? 0) + Number(line.total_amount ?? 0));
  const saleIds = [...ptAmount.keys()];
  const sales: {
    mindbody_sale_id: number;
    client_id: string | null;
    sale_datetime: string;
    sales_rep_staff_id: string | null;
  }[] = [];
  for (let index = 0; index < saleIds.length; index += 200) {
    const { data, error } = await supabase
      .from("sales")
      .select("mindbody_sale_id, client_id, sale_datetime, sales_rep_staff_id")
      .in("mindbody_sale_id", saleIds.slice(index, index + 200))
      .gte("sale_datetime", windowStartIso);
    if (error) throw new Error(`Failed to load sales: ${error.message}`);
    sales.push(...((data ?? []) as typeof sales));
  }

  const sessionsByClient = new Map<string, AppointmentRow[]>();
  for (const appointment of appointments) {
    if (!appointment.client_id || !appointment.staff_id) continue;
    sessionsByClient.set(appointment.client_id, [...(sessionsByClient.get(appointment.client_id) ?? []), appointment]);
  }

  const credited: SaleRow[] = [];
  let uncredited = 0;
  let soldBySales = 0;
  for (const sale of sales) {
    const amount = ptAmount.get(sale.mindbody_sale_id) ?? 0;
    if (amount === 0) continue;
    if (sale.sales_rep_staff_id && salesTeam.has(sale.sales_rep_staff_id)) {
      soldBySales += amount;
      continue;
    }
    const soldAt = DateTime.fromISO(sale.sale_datetime);
    const until = soldAt.plus({ days: PT_CREDIT_DAYS });
    const sessions = (sale.client_id ? (sessionsByClient.get(sale.client_id) ?? []) : [])
      .filter((session) => {
        const at = DateTime.fromISO(session.start_datetime);
        return at >= soldAt.startOf("day") && at <= until;
      })
      .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
    const counts = new Map<string, number>();
    for (const session of sessions) counts.set(session.staff_id!, (counts.get(session.staff_id!) ?? 0) + 1);
    let trainer: string | null = null;
    for (const session of sessions) {
      if (trainer === null || counts.get(session.staff_id!)! > counts.get(trainer)!) trainer = session.staff_id!;
    }
    if (trainer) credited.push({ sales_rep_staff_id: trainer, sale_datetime: sale.sale_datetime, total_amount: amount });
    else uncredited += amount;
  }
  return { credited, uncredited, soldBySales };
}

export type MonthBucket = { key: string; label: string; start: DateTime; end: DateTime };

function buildMonthBuckets(timezone: string): MonthBucket[] {
  const currentMonth = DateTime.now().setZone(timezone).startOf("month");
  const buckets: MonthBucket[] = [];

  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const start = currentMonth.minus({ months: i });
    buckets.push({
      key: start.toFormat("yyyy-MM"),
      label: start.toFormat("LLL yyyy"),
      start,
      end: start.endOf("month"),
    });
  }

  return buckets;
}

export type MonthStat = { sessions: number; salesTotal: number; ratio: number | null };
export type TrainerHealth = {
  staffId: string;
  displayName: string;
  months: MonthStat[];
  ytd: MonthStat;
  flagged: boolean;
  latestRatio: number | null;
};

function ratioOf(sessions: number, salesTotal: number, expectedRevenuePerSession: number): number | null {
  // Real N/A, not a fabricated 0%, when nobody serviced a session that
  // period -- there's nothing to benchmark, same convention as the
  // Instructors/Overview pages' zero-denominator handling.
  return sessions > 0 ? salesTotal / (sessions * expectedRevenuePerSession) : null;
}

function buildTrainerHealth(
  staff: StaffRow[],
  appointments: AppointmentRow[],
  sales: SaleRow[],
  buckets: MonthBucket[],
  yearStart: DateTime,
  expectedRevenuePerSession: number,
): TrainerHealth[] {
  const sessionsByStaffMonth = new Map<string, number>();
  const salesByStaffMonth = new Map<string, number>();
  const ytdSessionsByStaff = new Map<string, number>();
  const ytdSalesByStaff = new Map<string, number>();

  for (const appointment of appointments) {
    if (!appointment.staff_id) continue;
    const startedAt = DateTime.fromISO(appointment.start_datetime);
    const monthKey = startedAt.toFormat("yyyy-MM");
    const key = `${appointment.staff_id}:${monthKey}`;
    sessionsByStaffMonth.set(key, (sessionsByStaffMonth.get(key) ?? 0) + 1);

    if (startedAt >= yearStart) {
      ytdSessionsByStaff.set(appointment.staff_id, (ytdSessionsByStaff.get(appointment.staff_id) ?? 0) + 1);
    }
  }

  for (const sale of sales) {
    if (!sale.sales_rep_staff_id) continue;
    const soldAt = DateTime.fromISO(sale.sale_datetime);
    const monthKey = soldAt.toFormat("yyyy-MM");
    const key = `${sale.sales_rep_staff_id}:${monthKey}`;
    salesByStaffMonth.set(key, (salesByStaffMonth.get(key) ?? 0) + (sale.total_amount ?? 0));

    if (soldAt >= yearStart) {
      ytdSalesByStaff.set(
        sale.sales_rep_staff_id,
        (ytdSalesByStaff.get(sale.sales_rep_staff_id) ?? 0) + (sale.total_amount ?? 0),
      );
    }
  }

  return staff
    .map((member) => {
      const months = buckets.map((bucket) => {
        const key = `${member.id}:${bucket.key}`;
        const sessions = sessionsByStaffMonth.get(key) ?? 0;
        const salesTotal = salesByStaffMonth.get(key) ?? 0;
        return { sessions, salesTotal, ratio: ratioOf(sessions, salesTotal, expectedRevenuePerSession) };
      });

      const ytdSessions = ytdSessionsByStaff.get(member.id) ?? 0;
      const ytdSalesTotal = ytdSalesByStaff.get(member.id) ?? 0;
      const ytd = {
        sessions: ytdSessions,
        salesTotal: ytdSalesTotal,
        ratio: ratioOf(ytdSessions, ytdSalesTotal, expectedRevenuePerSession),
      };

      let streak = 0;
      let flagged = false;
      for (const month of months) {
        if (month.ratio !== null && month.ratio < HEALTH_THRESHOLD) {
          streak += 1;
          if (streak >= CONSECUTIVE_MONTHS_TO_FLAG) flagged = true;
        } else {
          streak = 0;
        }
      }

      // Most recent month with an actual ratio (i.e. sessions > 0), not
      // just the last bucket -- a trainer who serviced nothing this month
      // but was healthy last month shouldn't rank as if they had no data
      // at all.
      let latestRatio: number | null = null;
      for (let i = months.length - 1; i >= 0; i--) {
        if (months[i].ratio !== null) {
          latestRatio = months[i].ratio;
          break;
        }
      }

      return { staffId: member.id, displayName: member.display_name, months, ytd, flagged, latestRatio };
    })
    .filter((row) => row.months.some((month) => month.sessions > 0))
    .sort((a, b) => {
      // Leaderboard, worst-first -- this is an early-warning tool, so
      // whoever needs attention should be the first thing an admin sees,
      // not something they have to scan alphabetically for. Flagged
      // trainers (2+ consecutive months under benchmark) are pinned to the
      // very top regardless of their latest single-month number, since the
      // flag itself is the more urgent signal than one month's ratio.
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;

      // No-recent-data trainers sort after everyone with a real number,
      // within their flagged/unflagged group.
      if (a.latestRatio === null && b.latestRatio === null) {
        return a.displayName.localeCompare(b.displayName);
      }
      if (a.latestRatio === null) return 1;
      if (b.latestRatio === null) return -1;

      if (a.latestRatio !== b.latestRatio) return a.latestRatio - b.latestRatio;
      return a.displayName.localeCompare(b.displayName);
    });
}

// "All Trainers" summary row -- true aggregate (sum sessions / sum sales),
// not a mean of each trainer's own ratio, same reasoning as every other
// aggregate on this app (Overview, Instructors): a blended studio-wide
// number, not one that a single outlier trainer skews. Computed from the
// same per-trainer rows already built above so it only ever reflects
// trainers with visible activity, matching what's actually shown in the
// table beneath it.
function buildStudioSummary(
  trainerHealth: TrainerHealth[],
  buckets: MonthBucket[],
  expectedRevenuePerSession: number,
): { months: MonthStat[]; ytd: MonthStat } {
  const months = buckets.map((_, index) => {
    const sessions = trainerHealth.reduce((sum, row) => sum + row.months[index].sessions, 0);
    const salesTotal = trainerHealth.reduce((sum, row) => sum + row.months[index].salesTotal, 0);
    return { sessions, salesTotal, ratio: ratioOf(sessions, salesTotal, expectedRevenuePerSession) };
  });

  const ytdSessions = trainerHealth.reduce((sum, row) => sum + row.ytd.sessions, 0);
  const ytdSalesTotal = trainerHealth.reduce((sum, row) => sum + row.ytd.salesTotal, 0);
  const ytd = {
    sessions: ytdSessions,
    salesTotal: ytdSalesTotal,
    ratio: ratioOf(ytdSessions, ytdSalesTotal, expectedRevenuePerSession),
  };

  return { months, ytd };
}

export default async function TrainerHealthPage() {
  // Part of the trainer module: 404 when the studio doesn't have it.
  await requireModule("trainer");
  // Club admins and every trainer (trainers see all trainers' numbers).
  const currentStaff = await requireAccess(isTrainerAccess);

  const supabase = await getScopedClient(currentStaff);
  const org = await getOrg(supabase, currentStaff.organizationId);
  const buckets = buildMonthBuckets(org.timezone);
  const yearStart = DateTime.now().setZone(org.timezone).startOf("year");
  // The 6-month bucket window and the YTD window don't always agree on which
  // is earlier (YTD is shorter in Jan/Feb, longer by December) -- fetch back
  // to whichever starts first so both computations have complete data from a
  // single query.
  const windowStart = yearStart < buckets[0].start ? yearStart : buckets[0].start;
  const windowStartIso = windowStart.toUTC().toISO() ?? "";

  const [staff, appointments] = await Promise.all([
    getInstructors(supabase),
    getCompletedAppointments(supabase, windowStartIso),
  ]);
  const { credited: sales, uncredited, soldBySales } = await getPtSales(
    supabase,
    currentStaff.organizationId,
    windowStartIso,
    appointments,
  );

  const trainerHealth = buildTrainerHealth(
    staff,
    appointments,
    sales,
    buckets,
    yearStart,
    org.expected_revenue_per_session,
  );
  const studioSummary = buildStudioSummary(trainerHealth, buckets, org.expected_revenue_per_session);

  return (
    <DashboardShell
      title="Trainer Health"
      description={`Sessions and PT sales credited per trainer each month, against a $${org.expected_revenue_per_session.toFixed(2)}/session benchmark. Flagged after ${CONSECUTIVE_MONTHS_TO_FLAG}+ months under ${(HEALTH_THRESHOLD * 100).toFixed(0)}%.`}
    >
      <TrainerHealthTable
        // Luxon DateTime instances (bucket.start/end) aren't plain
        // serializable objects, so only the display-safe fields cross the
        // server/client boundary -- the client table never needs the actual
        // DateTime, just the label/key already computed here.
        buckets={buckets.map((bucket) => ({ key: bucket.key, label: bucket.label }))}
        trainerHealth={trainerHealth}
        studioSummary={studioSummary}
        healthThreshold={HEALTH_THRESHOLD}
        monthsShown={MONTHS_SHOWN}
      />

      <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground">
        <span className="font-medium text-muted-foreground">Sessions</span> counts appointments with status
        Completed. <span className="font-medium text-muted-foreground">Sales</span> is PT revenue: each PT package
        sold (items ticked as PT on Settings → Mindbody items) is credited, in the month it was sold, to the
        trainer who completed the most sessions with that client in the {PT_CREDIT_DAYS} days after the sale. PT
        rung up with a salesperson (someone who can sell) as the Mindbody sales rep counts as their sale, so no
        trainer is credited
        {soldBySales > 0 ? ` ($${Math.round(soldBySales).toLocaleString()} in this window)` : ""}.
        {uncredited > 0
          ? ` $${Math.round(uncredited).toLocaleString()} of PT sold in this window has no completed sessions yet, so it isn't credited to anyone.`
          : ""}{" "}
        <span className="font-medium text-muted-foreground">Ratio</span> is Sales ÷ (Sessions ×
        expected revenue per session, set in Settings) and reads N/A for a period with zero sessions
        rather than a misleading 0%. <span className="font-medium text-muted-foreground">Year to Date</span>{" "}
        spans Jan 1 of the current year through today, independent of the {MONTHS_SHOWN}-month window
        shown per-month. Trainers with no activity in the last {MONTHS_SHOWN} months are omitted.
        Ranked worst-first by most recent month&apos;s ratio, with flagged trainers pinned to the top.
      </p>
    </DashboardShell>
  );
}
