import { DashboardShell } from "@/components/dashboard-shell";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NotificationsForm } from "./notifications-form";
import { ReminderPreferenceToggle } from "./reminder-preference-toggle";

// Deliberately not admin-gated, unlike /dashboard/settings -- this is a
// personal per-device preference (which instructors need most, since open
// sub requests are the main trigger this exists for), not org configuration.
// middleware.ts already guarantees a real session to reach this page at
// all; currentStaff can still be null in the one narrow case of a session
// with no linked staff row.
export default async function NotificationsPage() {
  const currentStaff = await getCurrentStaff();

  // Not part of getCurrentStaff's own shape -- that type is used broadly
  // across the app, and this is the one page that needs this field. Admin
  // client, same reasoning as getCurrentStaff itself (no RLS SELECT policy
  // covers staff reading their own row's every column yet).
  let reminderOptOut = false;
  if (currentStaff) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("staff")
      .select("substitution_reminder_opt_out")
      .eq("id", currentStaff.id)
      .maybeSingle();
    reminderOptOut = data?.substitution_reminder_opt_out ?? false;
  }

  return (
    <DashboardShell
      title="Notifications"
      description="Manage push notifications for this device."
    >
      {currentStaff ? (
        <div className="flex flex-col gap-4">
          <NotificationsForm />
          <ReminderPreferenceToggle initialOptOut={reminderOptOut} />
        </div>
      ) : (
        <StaffNotProvisioned />
      )}
    </DashboardShell>
  );
}
