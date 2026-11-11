import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Shifts for a date range (studio dates, inclusive), for the Club Admin
// timesheet and the payroll export. Service role; callers check the role.

export type TimesheetPunch = {
  id: string;
  staffId: string;
  name: string;
  clockIn: string;
  clockOut: string | null;
  source: "clock" | "admin";
  edited: boolean;
};

export type TimesheetEdit = {
  id: string;
  punchId: string;
  action: "add" | "edit" | "delete";
  before: { clock_in_at?: string; clock_out_at?: string | null } | null;
  after: { clock_in_at?: string; clock_out_at?: string | null; deleted_at?: string } | null;
  reason: string;
  createdAt: string;
  editedBy: string;
  staffName: string;
};

export async function loadTimesheet(organizationId: string, from: string, to: string) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const start = DateTime.fromISO(from, { zone: timezone }).startOf("day").toUTC().toISO()!;
  const end = DateTime.fromISO(to, { zone: timezone }).endOf("day").toUTC().toISO()!;

  const [{ data: staffRows }, { data: punchRows }, { data: editRows }] = await Promise.all([
    admin.from("staff").select("id, display_name, auth_user_id, archived_at").eq("organization_id", organizationId),
    admin
      .from("time_punches")
      .select("id, staff_id, clock_in_at, clock_out_at, source")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .gte("clock_in_at", start)
      .lte("clock_in_at", end)
      .order("clock_in_at")
      .limit(5000),
    admin
      .from("time_punch_edits")
      .select(
        "id, punch_id, action, before, after, reason, created_at, edited_by_staff_id, punch:time_punches!inner ( staff_id, clock_in_at )",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const nameOf = new Map((staffRows ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const editedIds = new Set((editRows ?? []).map((row) => row.punch_id as string));
  const punches: TimesheetPunch[] = (punchRows ?? []).map((row) => ({
    id: row.id as string,
    staffId: row.staff_id as string,
    name: nameOf.get(row.staff_id as string) ?? "Unknown",
    clockIn: row.clock_in_at as string,
    clockOut: (row.clock_out_at as string | null) ?? null,
    source: row.source as "clock" | "admin",
    edited: editedIds.has(row.id as string),
  }));
  const edits: TimesheetEdit[] = (editRows ?? []).map((row) => {
    const punch = row.punch as unknown as { staff_id: string } | null;
    return {
      id: row.id as string,
      punchId: row.punch_id as string,
      action: row.action as TimesheetEdit["action"],
      before: row.before as TimesheetEdit["before"],
      after: row.after as TimesheetEdit["after"],
      reason: row.reason as string,
      createdAt: row.created_at as string,
      editedBy: nameOf.get(row.edited_by_staff_id as string) ?? "Unknown",
      staffName: punch ? (nameOf.get(punch.staff_id) ?? "Unknown") : "Unknown",
    };
  });
  // People who can clock in (have a sign-in, not archived), for "Add a shift".
  const people = (staffRows ?? [])
    .filter((row) => row.auth_user_id && !row.archived_at)
    .map((row) => ({ id: row.id as string, name: (row.display_name as string | null) ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { timezone, punches, edits, people };
}

// The range from ?from=&to= (YYYY-MM-DD), defaulting to the last 14 days.
export function resolveRange(params: { from?: string; to?: string }, timezone: string) {
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const valid = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const to = valid(params.to) ?? today;
  let from = valid(params.from) ?? DateTime.fromISO(to).minus({ days: 13 }).toISODate()!;
  if (from > to) from = to;
  return { from, to };
}
