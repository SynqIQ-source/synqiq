import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PAY_PERIOD_ANCHOR, nextPeriodStart, periodContaining } from "@/lib/trainer/pilot-rules";

// Trainer session pay by pay period (pilot). Service role; callers check who
// may see which trainer's lines.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type PeriodStatus = "open" | "approved" | "locked";
export type PayLine = {
  id: string;
  staffId: string;
  staffName: string;
  workDate: string;
  description: string;
  clientName: string | null;
  valueCents: number | null;
  valueEstimated: boolean;
  rateName: string | null;
  payPercent: number | null;
  amountCents: number;
  reversal: boolean;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
};

// The last `count` periods up to and including the one containing `today`.
export function recentPeriods(today: string, count = 8) {
  const current = periodContaining(today, PAY_PERIOD_ANCHOR);
  const list = [current];
  let cursor = current;
  for (let i = 1; i < count; i += 1) {
    const prevStart = periodContaining(
      new Date(Date.parse(`${cursor.startsOn}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
      PAY_PERIOD_ANCHOR,
    );
    if (prevStart.startsOn < PAY_PERIOD_ANCHOR) break;
    list.push(prevStart);
    cursor = prevStart;
  }
  return { current, list, next: periodContaining(nextPeriodStart(current), PAY_PERIOD_ANCHOR) };
}

export async function loadPeriod(admin: Admin, organizationId: string, startsOn: string, onlyStaffId?: string) {
  const period = periodContaining(startsOn, PAY_PERIOD_ANCHOR);
  const { data: row } = await admin
    .from("pay_periods")
    .select("id, status, approved_at, locked_at, approved_by_staff_id, locked_by_staff_id")
    .eq("organization_id", organizationId)
    .eq("starts_on", period.startsOn)
    .maybeSingle();
  const select =
    "id, staff_id, work_date, description, client_name, value_cents, value_estimated, pay_rate_name, pay_percent, amount_cents, reverses_event_id, reason, created_by_staff_id, created_at";
  const inPeriod = row
    ? admin.from("payroll_events").select(select).eq("organization_id", organizationId).eq("kind", "session").eq("pay_period_id", row.id)
    : null;
  // Lines from before pay periods existed: by their date (voided ones skipped).
  const older = admin
    .from("payroll_events")
    .select(select)
    .eq("organization_id", organizationId)
    .eq("kind", "session")
    .is("pay_period_id", null)
    .is("voided_at", null)
    .gte("work_date", period.startsOn)
    .lte("work_date", period.endsOn);
  const [a, b] = await Promise.all([
    inPeriod ? (onlyStaffId ? inPeriod.eq("staff_id", onlyStaffId) : inPeriod) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    onlyStaffId ? older.eq("staff_id", onlyStaffId) : older,
  ]);
  const rows = [...(a.data ?? []), ...(b.data ?? [])] as Record<string, unknown>[];
  const staffIds = [...new Set(rows.flatMap((r) => [r.staff_id as string, r.created_by_staff_id as string | null]).filter(Boolean))] as string[];
  const { data: people } = staffIds.length ? await admin.from("staff").select("id, display_name").in("id", staffIds) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? "Staff"]));
  const lines: PayLine[] = rows
    .map((r) => ({
      id: r.id as string,
      staffId: r.staff_id as string,
      staffName: name.get(r.staff_id as string) ?? "Staff",
      workDate: String(r.work_date).slice(0, 10),
      description: r.description as string,
      clientName: (r.client_name as string | null) ?? null,
      valueCents: r.value_cents == null ? null : Number(r.value_cents),
      valueEstimated: r.value_estimated === true,
      rateName: (r.pay_rate_name as string | null) ?? null,
      payPercent: r.pay_percent == null ? null : Number(r.pay_percent),
      amountCents: Number(r.amount_cents ?? 0),
      reversal: Boolean(r.reverses_event_id),
      reason: (r.reason as string | null) ?? null,
      createdBy: r.created_by_staff_id ? (name.get(r.created_by_staff_id as string) ?? "Staff") : null,
      createdAt: r.created_at as string,
    }))
    .sort((x, y) => x.staffName.localeCompare(y.staffName) || x.workDate.localeCompare(y.workDate) || x.createdAt.localeCompare(y.createdAt));
  const totals = new Map<string, { staffName: string; sessions: number; amountCents: number }>();
  for (const line of lines) {
    const t = totals.get(line.staffId) ?? { staffName: line.staffName, sessions: 0, amountCents: 0 };
    t.sessions += line.reversal ? -1 : 1;
    t.amountCents += line.amountCents;
    totals.set(line.staffId, t);
  }
  return {
    period,
    id: (row?.id as string | undefined) ?? null,
    status: ((row?.status as PeriodStatus | undefined) ?? "open") as PeriodStatus,
    lockedAt: (row?.locked_at as string | null) ?? null,
    approvedAt: (row?.approved_at as string | null) ?? null,
    lines,
    totals: [...totals.entries()].map(([staffId, t]) => ({ staffId, ...t })).sort((x, y) => x.staffName.localeCompare(y.staffName)),
  };
}

const csvCell = (value: string | number | null) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const dollars = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2));

export function periodCsv(lines: PayLine[]): string {
  const header = ["Trainer", "Date", "Session", "Client", "Session value", "Rate", "Pay %", "Amount", "Reversal", "Reason", "Recorded by"];
  const body = lines.map((l) =>
    [
      l.staffName,
      l.workDate,
      l.description,
      l.clientName,
      dollars(l.valueCents),
      l.rateName,
      l.payPercent,
      dollars(l.amountCents),
      l.reversal ? "yes" : "",
      l.reason,
      l.createdBy,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n") + "\n";
}
