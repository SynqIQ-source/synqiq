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
    .select("id, display_name, role, can_sell, is_instructor, is_trainer, email, mindbody_staff_id, auth_user_id, active, archived_at")
    .order("display_name", { ascending: true })
    .returns<StaffLinkingRow[]>();

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return (
    <DashboardShell
      title="Staff & Roles"
      description="Set each person's role and what they do (Instructor, Trainer, Sells), and send their SynqIQ login. Staff join by invite only."
    >
      <StaffLinkingTable staff={staff ?? []} />
    </DashboardShell>
  );
}
