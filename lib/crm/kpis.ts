import { DateTime } from "luxon";
import type { Funnel } from "@/lib/crm/funnel";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Monthly sales targets (KPIs). Admins set them on Settings → Sales Targets,
// per month, for the whole club and for each salesperson. A month with no
// targets of its own uses the latest earlier month's, so targets carry
// forward until someone changes them.

export type KpiKind = "count" | "percent";
export type KpiMetric = {
  key: string;
  label: string;
  kind: KpiKind;
  actual: (funnel: Funnel) => number | null;
};
export type KpiSection = { key: string; title: string; metrics: KpiMetric[] };

const rate = (count: number, of: number) => (of === 0 ? null : (count / of) * 100);

export const KPI_SECTIONS: KpiSection[] = [
  {
    key: "walk_ins",
    title: "Walk-ins",
    metrics: [
      {
        key: "walk_ins",
        label: "Walk-ins",
        kind: "count",
        actual: (f) => f.walkIns.total,
      },
      {
        key: "walk_ins_closed",
        label: "Closed",
        kind: "count",
        actual: (f) => f.walkIns.closed,
      },
      {
        key: "walk_ins_close_rate",
        label: "Closing %",
        kind: "percent",
        actual: (f) => rate(f.walkIns.closed, f.walkIns.total),
      },
    ],
  },
  {
    key: "guests",
    title: "Guests of members",
    metrics: [
      {
        key: "guests",
        label: "Guests",
        kind: "count",
        actual: (f) => f.guestsOfMembers.total,
      },
      {
        key: "guests_closed",
        label: "Closed",
        kind: "count",
        actual: (f) => f.guestsOfMembers.closed,
      },
      {
        key: "guests_close_rate",
        label: "Closing %",
        kind: "percent",
        actual: (f) => rate(f.guestsOfMembers.closed, f.guestsOfMembers.total),
      },
    ],
  },
  {
    key: "returning",
    title: "Returning guests",
    metrics: [
      {
        key: "returning",
        label: "Returning",
        kind: "count",
        actual: (f) => f.returning.total,
      },
      {
        key: "returning_closed",
        label: "Closed",
        kind: "count",
        actual: (f) => f.returning.closed,
      },
      {
        key: "returning_close_rate",
        label: "Closing %",
        kind: "percent",
        actual: (f) => rate(f.returning.closed, f.returning.total),
      },
    ],
  },
  {
    key: "leads",
    title: "New leads",
    metrics: [
      {
        key: "leads",
        label: "Total leads",
        kind: "count",
        actual: (f) => f.leads.total,
      },
      {
        key: "contacted",
        label: "Contacted",
        kind: "count",
        actual: (f) => f.leads.contacted,
      },
      {
        key: "appointments",
        label: "Appointments made",
        kind: "count",
        actual: (f) => f.leads.appointments,
      },
      {
        key: "appointment_rate",
        label: "Conversion %",
        kind: "percent",
        actual: (f) => rate(f.leads.appointments, f.leads.total),
      },
    ],
  },
  {
    // Appointments set for the period, whoever they're for (not only new
    // leads): scheduled, shows, and shows who bought.
    key: "appointments",
    title: "Appointments",
    metrics: [
      {
        key: "appointments_scheduled",
        label: "Scheduled",
        kind: "count",
        actual: (f) => f.appointments.scheduled,
      },
      {
        key: "shows",
        label: "Shows",
        kind: "count",
        actual: (f) => f.appointments.showed,
      },
      {
        key: "show_rate",
        label: "Show %",
        kind: "percent",
        actual: (f) => rate(f.appointments.showed, f.appointments.scheduled),
      },
      {
        key: "appointments_closed",
        label: "Appointments closed",
        kind: "count",
        actual: (f) => f.appointments.closed,
      },
      {
        key: "appointment_close_rate",
        label: "Appt. closing %",
        kind: "percent",
        actual: (f) => rate(f.appointments.closed, f.appointments.showed),
      },
    ],
  },
  {
    key: "contacts",
    title: "Contacts",
    metrics: [
      {
        key: "calls",
        label: "Calls",
        kind: "count",
        actual: (f) => f.activity.calls,
      },
      {
        key: "texts",
        label: "Texts",
        kind: "count",
        actual: (f) => f.activity.texts,
      },
      {
        key: "emails",
        label: "Emails",
        kind: "count",
        actual: (f) => f.activity.emails,
      },
    ],
  },
  {
    key: "total",
    title: "Total",
    metrics: [
      {
        key: "total_guests",
        label: "Total guests",
        kind: "count",
        actual: (f) => f.totals.guests,
      },
      {
        key: "enrolled",
        label: "Enrolled",
        kind: "count",
        actual: (f) => f.totals.enrolled,
      },
      {
        key: "total_close_rate",
        label: "Closing %",
        kind: "percent",
        actual: (f) => rate(f.totals.enrolled, f.totals.guests),
      },
    ],
  },
];

export const KPI_METRICS = new Map(KPI_SECTIONS.flatMap((section) => section.metrics.map((m) => [m.key, m] as const)));

// metric key -> target value.
export type Targets = Map<string, number>;

export type EffectiveTargets = {
  targets: Targets;
  // The month these targets were set for (earlier than the one asked for
  // when they carried forward), or null when none have been set yet.
  fromMonth: string | null;
};

type TargetRow = {
  month: string;
  staff_id: string | null;
  metric: string;
  target: number | string;
};

// Targets that apply in `month` (YYYY-MM-01) for the club (staffId null) or
// one salesperson: that month's own, else the latest earlier month's.
export async function effectiveTargets(
  supabase: ScopedSupabaseClient,
  options: { month: string; staffId: string | null },
): Promise<EffectiveTargets> {
  let latest = supabase
    .from("crm_kpi_targets")
    .select("month")
    .lte("month", options.month)
    .order("month", { ascending: false })
    .limit(1);
  latest = options.staffId ? latest.eq("staff_id", options.staffId) : latest.is("staff_id", null);
  const { data: monthRow, error: monthError } = await latest.maybeSingle();
  if (monthError) throw monthError;
  if (!monthRow) return { targets: new Map(), fromMonth: null };

  let rows = supabase.from("crm_kpi_targets").select("month, staff_id, metric, target").eq("month", monthRow.month);
  rows = options.staffId ? rows.eq("staff_id", options.staffId) : rows.is("staff_id", null);
  const { data, error } = await rows.returns<TargetRow[]>();
  if (error) throw error;
  return {
    targets: new Map(
      (data ?? []).filter((row) => KPI_METRICS.has(row.metric)).map((row) => [row.metric, Number(row.target)]),
    ),
    fromMonth: monthRow.month as string,
  };
}

// Every target row for the org (club and salespeople), for building each
// month's effective targets in bulk (Sales History).
export async function allTargetRows(supabase: ScopedSupabaseClient): Promise<TargetRow[]> {
  const { data, error } = await supabase
    .from("crm_kpi_targets")
    .select("month, staff_id, metric, target")
    .order("month")
    .returns<TargetRow[]>();
  if (error) throw error;
  return data ?? [];
}

export function targetsForMonth(rows: TargetRow[], month: string, staffId: string | null): Targets {
  const scoped = rows.filter((row) => row.staff_id === staffId && row.month <= month);
  const latest = scoped.reduce<string | null>((max, row) => (max === null || row.month > max ? row.month : max), null);
  return new Map(
    scoped
      .filter((row) => row.month === latest && KPI_METRICS.has(row.metric))
      .map((row) => [row.metric, Number(row.target)]),
  );
}

export function monthKey(date: DateTime): string {
  return date.startOf("month").toISODate()!;
}

export function formatKpi(value: number | null, kind: KpiKind): string {
  if (value === null) return "—";
  if (kind === "percent") return `${Math.round(value)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
