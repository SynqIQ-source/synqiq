import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { KioskDevicesCard, MarketingSourcesCard, SellersCard, WaiverCard } from "./crm-settings";

export const dynamic = "force-dynamic";

// CRM setup for admins: kiosk pairing, waiver versions, "how did you hear"
// options and who can sell. Admin + CRM module only; everyone else gets 404.
export default async function CrmSettingsPage() {
  const staff = await requireCrmStaff();
  if (staff.role !== "admin") notFound();

  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const [devices, waivers, sources, staffRows] = await Promise.all([
    supabase
      .from("kiosk_devices")
      .select("id, name, activated_at, revoked_at, last_seen_at, activation_expires_at, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("waiver_templates")
      .select("id, version, body, is_active, published_at")
      .order("version", { ascending: false }),
    supabase.from("crm_marketing_sources").select("id, label, active, sort_order").order("sort_order"),
    supabase
      .from("staff")
      .select("id, display_name, role, can_sell")
      .is("archived_at", null)
      .order("display_name"),
  ]);
  if (devices.error || waivers.error || sources.error || staffRows.error) {
    throw new Error("Failed to load CRM settings.");
  }

  return (
    <DashboardShell title="CRM" description="Guest check-in kiosk, waiver, and sales team settings.">
      <div className="space-y-6">
        <KioskDevicesCard devices={devices.data ?? []} timezone={org.timezone} />
        <WaiverCard waivers={waivers.data ?? []} timezone={org.timezone} />
        <MarketingSourcesCard sources={sources.data ?? []} />
        <SellersCard staff={staffRows.data ?? []} />
      </div>
    </DashboardShell>
  );
}
