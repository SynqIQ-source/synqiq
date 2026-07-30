import { DashboardShell } from "@/components/dashboard-shell";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { NotificationsForm } from "./notifications-form";

// Deliberately not admin-gated, unlike /dashboard/settings -- this is a
// personal per-device preference (which instructors need most, since open
// sub requests are the main trigger this exists for), not org configuration.
// middleware.ts already guarantees a real session to reach this page at
// all; currentStaff can still be null in the one narrow case of a session
// with no linked staff row.
export default async function NotificationsPage() {
  const currentStaff = await getCurrentStaff();

  return (
    <DashboardShell
      title="Notifications"
      description="Manage push notifications for this device."
    >
      {currentStaff ? <NotificationsForm /> : <StaffNotProvisioned />}
    </DashboardShell>
  );
}
