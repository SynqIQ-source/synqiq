import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeRate, toPayRate } from "@/lib/payroll/rates";
import { PayRatesEditor, type PayPerson, type PayTarget, type RateRow } from "./pay-rates-editor";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeLabel(value: string | null) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Club Admin: the pay rates (class formula, % of session value or flat) and
// who is paid what -- hourly rate for time clock hours, default class and
// session rates, and exceptions for one class, class type or session type.
export default async function PayRatesPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const today = new Date().toISOString().slice(0, 10);
  const [rates, people, settings, assignments, schedules, classTypes, sessionTypes] = await Promise.all([
    admin.from("pay_rates").select("*").eq("organization_id", org).is("archived_at", null).order("name"),
    admin
      .from("staff")
      .select("id, display_name, role, is_instructor, is_trainer, can_sell, mindbody_staff_id, archived_at, active")
      .eq("organization_id", org)
      .order("display_name"),
    admin.from("staff_pay_settings").select("staff_id, hourly_rate_cents, class_rate_id, appointment_rate_id").eq("organization_id", org),
    admin.from("staff_pay_assignments").select("id, staff_id, scope, mindbody_id, label, pay_rate_id").eq("organization_id", org),
    admin
      .from("class_schedules")
      .select("mindbody_class_schedule_id, class_name, days, start_time, staff_mindbody_id, end_date")
      .eq("organization_id", org)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("class_name"),
    admin.from("class_types").select("mindbody_class_description_id, name").eq("organization_id", org).eq("active", true).order("name"),
    admin.from("session_types").select("mindbody_session_type_id, name, kind").eq("organization_id", org).order("name"),
  ]);

  const rateRows: RateRow[] = (rates.data ?? []).map((row) => {
    const rate = toPayRate(row);
    return { ...rate, summary: describeRate(rate) };
  });
  const settingsBy = new Map((settings.data ?? []).map((row) => [row.staff_id as string, row]));
  const staffByMindbody = new Map((people.data ?? []).map((row) => [Number(row.mindbody_staff_id), row.id as string]));
  const payPeople: PayPerson[] = (people.data ?? [])
    // Archived people still show while they have pay set, so their last pay
    // period can be run; clear their rates to drop them from this list.
    .filter((row) => (row.active !== false && !row.archived_at) || settingsBy.has(row.id as string))
    .map((row) => {
      const setting = settingsBy.get(row.id as string);
      const tags = [
        row.role === "admin" ? "Club Admin" : row.role === "sales_lead" ? "Sales Lead" : row.role === "sales" ? "Sales" : "Staff",
        row.is_instructor ? "Instructor" : null,
        row.is_trainer ? "Trainer" : null,
        row.archived_at ? "Archived" : null,
      ].filter(Boolean) as string[];
      return {
        id: row.id as string,
        name: (row.display_name as string | null) ?? "Unknown",
        tags,
        hourly: setting?.hourly_rate_cents == null ? "" : (Number(setting.hourly_rate_cents) / 100).toFixed(2),
        classRateId: (setting?.class_rate_id as string | null) ?? "",
        appointmentRateId: (setting?.appointment_rate_id as string | null) ?? "",
        exceptions: (assignments.data ?? [])
          .filter((a) => a.staff_id === row.id)
          .map((a) => ({
            id: a.id as string,
            scope: a.scope as PayTarget["scope"],
            mindbodyId: Number(a.mindbody_id),
            label: (a.label as string | null) ?? `#${a.mindbody_id}`,
            payRateId: a.pay_rate_id as string,
          })),
      };
    });
  const targets: PayTarget[] = [
    ...(schedules.data ?? []).map((row) => ({
      scope: "class_schedule" as const,
      mindbodyId: Number(row.mindbody_class_schedule_id),
      label: `${row.class_name ?? "Class"} · ${((row.days as number[] | null) ?? []).map((d) => DAYS[d]).join("/")} ${timeLabel(row.start_time as string | null)}`,
      staffId: row.staff_mindbody_id ? (staffByMindbody.get(Number(row.staff_mindbody_id)) ?? null) : null,
    })),
    ...(classTypes.data ?? []).map((row) => ({
      scope: "class_type" as const,
      mindbodyId: Number(row.mindbody_class_description_id),
      label: `All ${row.name} classes`,
      staffId: null,
    })),
    ...(sessionTypes.data ?? [])
      .filter((row) => row.kind !== "Class")
      .map((row) => ({
        scope: "session_type" as const,
        mindbodyId: Number(row.mindbody_session_type_id),
        label: row.name as string,
        staffId: null,
      })),
  ];

  return (
    <DashboardShell
      title="Pay Rates"
      description="How each person is paid: an hourly rate for time clock hours, a class rate, and a session rate (a percent of what the client paid per session, or a flat amount)."
    >
      <PayRatesEditor rates={rateRows} people={payPeople} targets={targets} />
    </DashboardShell>
  );
}
