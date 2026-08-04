import { Fragment } from "react";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";

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

type MonthBucket = { key: string; label: string; start: DateTime; end: DateTime };

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

type MonthStat = { sessions: number; salesTotal: number; ratio: number | null };
type TrainerHealth = {
  staffId: string;
  displayName: string;
  months: MonthStat[];
  flagged: boolean;
  latestRatio: number | null;
};

function buildTrainerHealth(
  staff: StaffRow[],
  appointments: AppointmentRow[],
  sales: SaleRow[],
  buckets: MonthBucket[],
  expectedRevenuePerSession: number,
): TrainerHealth[] {
  const sessionsByStaffMonth = new Map<string, number>();
  const salesByStaffMonth = new Map<string, number>();

  for (const appointment of appointments) {
    if (!appointment.staff_id) continue;
    const monthKey = DateTime.fromISO(appointment.start_datetime).toFormat("yyyy-MM");
    const key = `${appointment.staff_id}:${monthKey}`;
    sessionsByStaffMonth.set(key, (sessionsByStaffMonth.get(key) ?? 0) + 1);
  }

  for (const sale of sales) {
    if (!sale.sales_rep_staff_id) continue;
    const monthKey = DateTime.fromISO(sale.sale_datetime).toFormat("yyyy-MM");
    const key = `${sale.sales_rep_staff_id}:${monthKey}`;
    salesByStaffMonth.set(key, (salesByStaffMonth.get(key) ?? 0) + (sale.total_amount ?? 0));
  }

  return staff
    .map((member) => {
      const months = buckets.map((bucket) => {
        const key = `${member.id}:${bucket.key}`;
        const sessions = sessionsByStaffMonth.get(key) ?? 0;
        const salesTotal = salesByStaffMonth.get(key) ?? 0;
        // Real N/A, not a fabricated 0%, when nobody serviced a session
        // that month -- there's nothing to benchmark, same convention as
        // the Instructors/Overview pages' zero-denominator handling.
        const ratio = sessions > 0 ? salesTotal / (sessions * expectedRevenuePerSession) : null;
        return { sessions, salesTotal, ratio };
      });

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

      return { staffId: member.id, displayName: member.display_name, months, flagged, latestRatio };
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

export default async function TrainerHealthPage() {
  const currentStaff = await getCurrentStaff();

  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const org = await getOrg(supabase, currentStaff.organizationId);
  const buckets = buildMonthBuckets(org.timezone);
  const windowStartIso = buckets[0].start.toUTC().toISO() ?? "";

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
    org.expected_revenue_per_session,
  );

  return (
    <DashboardShell
      title="Trainer Health"
      description={`Sessions serviced and sales credited per trainer, per month, benchmarked against $${org.expected_revenue_per_session.toFixed(2)}/session. Flags a trainer whose credited sales fall below ${(HEALTH_THRESHOLD * 100).toFixed(0)}% of that benchmark for ${CONSECUTIVE_MONTHS_TO_FLAG}+ consecutive months.`}
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left">Trainer</th>
              {buckets.map((bucket) => (
                <th key={bucket.key} className="p-3 text-right" colSpan={3}>
                  {bucket.label}
                </th>
              ))}
            </tr>
            <tr className="border-b text-xs text-zinc-500">
              <th className="p-3 text-left"></th>
              {buckets.map((bucket) => (
                <Fragment key={bucket.key}>
                  <th className="p-3 text-right font-normal">Sessions</th>
                  <th className="p-3 text-right font-normal">Sales</th>
                  <th className="p-3 text-right font-normal">Ratio</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {trainerHealth.length === 0 ? (
              <tr>
                <td className="p-3 text-zinc-500" colSpan={1 + buckets.length * 3}>
                  No trainer activity in the last {MONTHS_SHOWN} months.
                </td>
              </tr>
            ) : (
              trainerHealth.map((row) => (
                <tr key={row.staffId} className="border-b">
                  <td className="p-3 font-medium">
                    {row.displayName}
                    {row.flagged && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Under benchmark
                      </span>
                    )}
                  </td>
                  {row.months.map((month, index) => (
                    <Fragment key={buckets[index].key}>
                      <td className="p-3 text-right">{month.sessions}</td>
                      <td className="p-3 text-right">
                        {month.salesTotal > 0
                          ? `$${month.salesTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          : "--"}
                      </td>
                      <td
                        className={`p-3 text-right font-medium ${
                          month.ratio === null
                            ? "font-normal text-zinc-400"
                            : month.ratio < HEALTH_THRESHOLD
                              ? "text-red-600"
                              : "text-green-700"
                        }`}
                      >
                        {month.ratio !== null ? `${(month.ratio * 100).toFixed(0)}%` : "N/A"}
                      </td>
                    </Fragment>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">
        <span className="font-medium text-zinc-600">Sessions</span> counts appointments with status
        Completed. <span className="font-medium text-zinc-600">Sales</span> is the total credited to
        that trainer as sales rep (MindBody&apos;s SalesRepId), regardless of what was sold.{" "}
        <span className="font-medium text-zinc-600">Ratio</span> is Sales ÷ (Sessions ×
        expected revenue per session, set in Settings) and reads N/A for a month with zero sessions
        rather than a misleading 0%. Trainers with no activity in the last {MONTHS_SHOWN} months are
        omitted. Ranked worst-first by most recent month&apos;s ratio, with flagged trainers pinned
        to the top.
      </p>
    </DashboardShell>
  );
}
