import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { NotificationsForm } from "./notifications-form";

// Deliberately not admin-gated, unlike /dashboard/settings -- this is a
// personal per-device preference (which instructors need most, since open
// sub requests are the main trigger this exists for), not org configuration.
// A push subscription is tied to a real staff identity, though, so the
// no-login dropdown-mode staff (no real auth session) can't use it -- shown
// a plain message instead of a form that would just 403 on submit.
export default async function NotificationsPage() {
  const currentStaff = await getCurrentStaff();

  return (
    <DashboardShell
      title="Notifications"
      description="Manage push notifications for this device."
    >
      {currentStaff ? (
        <NotificationsForm />
      ) : (
        <p className="text-sm text-zinc-500">
          Sign in with a real account to enable notifications on this device.{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Go to sign in
          </Link>
        </p>
      )}
    </DashboardShell>
  );
}
