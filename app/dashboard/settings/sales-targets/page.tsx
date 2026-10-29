import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { effectiveTargets, monthKey } from "@/lib/crm/kpis";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { TargetsForm } from "./targets-form";

export const dynamic = "force-dynamic";

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])-01$/;

// Monthly sales targets, per month, for the whole club and each salesperson.
// They show on the Sales dashboard and Sales History. Admin + CRM only.
export default async function SalesTargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; staff?: string }>;
}) {
  const staff = await requireCrmStaff();
  if (staff.role !== "admin") notFound();
  const params = await searchParams;
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const now = DateTime.now().setZone(org.timezone);

  // Last 6 months through the next 6.
  const months = Array.from({ length: 13 }, (_, index) => {
    const date = now.startOf("month").plus({ months: 6 - index });
    return { value: monthKey(date), label: date.toFormat("LLLL yyyy") };
  });
  const month = params.month && MONTH_PARAM.test(params.month) ? params.month : monthKey(now);
  if (!months.some((option) => option.value === month)) {
    months.push({
      value: month,
      label: DateTime.fromISO(month).toFormat("LLLL yyyy"),
    });
  }

  const { data: staffRows, error: staffError } = await supabase
    .from("staff")
    .select("id, display_name, can_sell, role, archived_at")
    .order("display_name");
  if (staffError) throw new Error("Failed to load staff.");
  const salespeople = (staffRows ?? [])
    .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
    .map((member) => ({
      id: member.id as string,
      name: member.display_name as string,
    }));
  const staffId = params.staff && salespeople.some((person) => person.id === params.staff) ? params.staff : null;

  const { targets, fromMonth } = await effectiveTargets(supabase, {
    month,
    staffId,
  });

  return (
    <DashboardShell title="Sales Targets" description="Monthly targets shown on the Sales dashboard and Sales History.">
      <TargetsForm
        key={`${month}:${staffId ?? "club"}`}
        month={month}
        months={months}
        staffId={staffId}
        salespeople={salespeople}
        initial={Object.fromEntries(targets)}
        carriedFrom={fromMonth && fromMonth !== month ? DateTime.fromISO(fromMonth).toFormat("LLLL yyyy") : null}
        hasOwn={fromMonth === month}
      />
    </DashboardShell>
  );
}
