import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { EligibilityTable, type DepartmentRow } from "./eligibility-table";

export default async function EligibilitySettingsPage() {
  const currentStaff = await getCurrentStaff();

  // Real page-level guard, same as /dashboard/settings and
  // /dashboard/settings/staff -- this page triggers real writes, not just a
  // read view.
  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const { data: departments, error } = await supabase
    .from("departments")
    .select("id, name")
    .order("name")
    .returns<DepartmentRow[]>();

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  return (
    <DashboardShell
      title="Class Eligibility"
      description="Choose which instructors get pinged when a class in a given department needs a substitute. A class with no eligible instructors notifies no one."
    >
      <EligibilityTable departments={departments ?? []} />
    </DashboardShell>
  );
}
