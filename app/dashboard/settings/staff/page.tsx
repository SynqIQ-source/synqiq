import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { StaffLinkingTable, type StaffLinkingRow } from "./staff-linking-table";

export default async function StaffSettingsPage() {
  const currentStaff = await getCurrentStaff();

  // Real page-level guard, same as /dashboard/settings and
  // /dashboard/settings/imports -- this page triggers real invites, not
  // just a read view.
  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, display_name, role, email, mindbody_staff_id, auth_user_id, active")
    .order("display_name", { ascending: true })
    .returns<StaffLinkingRow[]>();

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return (
    <DashboardShell
      title="Staff Logins"
      description="Link each staff member's synced Mindbody record to a real Synq login. There's no self-serve signup -- an invite is the only way in."
    >
      <StaffLinkingTable staff={staff ?? []} />
    </DashboardShell>
  );
}
