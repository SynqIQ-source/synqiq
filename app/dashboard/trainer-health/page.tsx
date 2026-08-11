import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { TrainerHealthTable } from "./trainer-health-table";

const MONTHS_SHOWN = 6;
const PAGE_SIZE = 1000;
// Ratio below this for 2+ consecutive months is the early-warning flag the
// user asked for -- not configurable (unlike expected_revenue_per_session,
// which is the actual dollar benchmark), since the "how many consecutive
// months" question wasn't part of what was asked to be adjustable.
const HEALTH_THRESHOLD = 0.8;
const CONSECUTIVE_MONTHS_TO_FLAG = 2;

type StaffRow = { id: string; display_name: string };
type AppointmentRow = { staff_id: string | null; status: string; start_datetime: string };
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

async function getInstructors(supabase: ScopedSupabaseClient): Promise<StaffRow[]> {
  const { data, error } = await supabase.from("staff").select("id, display_name").eq("role", "instructor");

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
      .select("staff_id, status, start_datetime")
      .eq("status", "Completed")
      .gte("start_datetime", windowStartIso)
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

async function getSales(supabase: ScopedSupabaseClient, windowStartIso: string): Promise<SaleRow[]> {
  const allRows: SaleRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("sales")
      .select("sales_rep_staff_id, sale_datetime, total_amount")
      .not("sales_rep_staff_id", "is", null)
      .gte("sale_datetime", windowStartIso)
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<SaleRow[]>();

    if (error) {
      throw new Error(`Failed to load sales: ${error.message}`);
    }

    allRows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
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
  const currentStaff = await getCurrentStaff();

  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

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

  const [staff, appointments, sales] = await Promise.all([
    getInstructors(supabase),
    getCompletedAppointments(supabase, windowStartIso),
    getSales(supabase, windowStartIso),
  ]);

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
      description={`Sessions serviced and sales credited per trainer, per month, benchmarked against $${org.expected_revenue_per_session.toFixed(2)}/session. Flags a trainer whose credited sales fall below ${(HEALTH_THRESHOLD * 100).toFixed(0)}% of that benchmark for ${CONSECUTIVE_MONTHS_TO_FLAG}+ consecutive months.`}
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

      <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">
        <span className="font-medium text-zinc-600">Sessions</span> counts appointments with status
        Completed. <span className="font-medium text-zinc-600">Sales</span> is the total credited to
        that trainer as sales rep (MindBody&apos;s SalesRepId), regardless of what was sold.{" "}
        <span className="font-medium text-zinc-600">Ratio</span> is Sales ÷ (Sessions ×
        expected revenue per session, set in Settings) and reads N/A for a period with zero sessions
        rather than a misleading 0%. <span className="font-medium text-zinc-600">Year to Date</span>{" "}
        spans Jan 1 of the current year through today, independent of the {MONTHS_SHOWN}-month window
        shown per-month. Trainers with no activity in the last {MONTHS_SHOWN} months are omitted.
        Ranked worst-first by most recent month&apos;s ratio, with flagged trainers pinned to the top.
      </p>
    </DashboardShell>
  );
}
