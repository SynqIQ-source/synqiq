import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { AccountForm } from "./account-form";

export default async function AccountPage() {
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    redirect("/login");
  }

  const supabase = await getScopedClient(currentStaff);
  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, display_name, title, photo_url, role, email")
    .eq("id", currentStaff.id)
    .single();

  if (error || !staff) {
    throw new Error(error?.message ?? "Failed to load your account.");
  }

  return (
    <DashboardShell title="My Account" description="Your name, photo, title, and login.">
      <AccountForm staff={staff} />
    </DashboardShell>
  );
}
