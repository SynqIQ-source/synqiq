import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { BrandingForm } from "./branding-form";

export default async function SettingsPage() {
  const currentStaff = await getCurrentStaff();

  // Real page-level guard, unlike every other admin-only page in this app
  // (which only hide the nav link and rely on RLS silently emptying the
  // data for a non-admin who navigates here directly). This page has a save
  // button, not just a read view -- a non-admin silently hitting an RLS
  // rejection on submit is a worse dead end than not landing here at all.
  // See conversation history for why this page deviates from the pattern.
  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const { data: organization, error } = await supabase
    .from("organizations")
    .select("id, name, primary_color, accent_color, font_family, logo_url")
    .eq("id", currentStaff.organizationId)
    .single();

  if (error || !organization) {
    throw new Error(error?.message ?? "Failed to load organization.");
  }

  return (
    <DashboardShell
      title="Settings"
      description="Customize your studio's branding across the dashboard."
    >
      <BrandingForm organization={organization} />
    </DashboardShell>
  );
}
