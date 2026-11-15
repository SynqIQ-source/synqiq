import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { EmailCheckCard, KioskDevicesCard, LeadFormsCard, MarketingSourcesCard, SellersCard, WaiverCard } from "./crm-settings";
import { SpamCard } from "./spam-card";

export const dynamic = "force-dynamic";

// CRM setup for admins: kiosk pairing, website form webhooks, waiver versions, "how did you hear"
// options and who can sell. Admin + CRM module only; everyone else gets 404.
export default async function CrmSettingsPage() {
  const staff = await requireCrmStaff();
  if (staff.role !== "admin") notFound();

  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const [devices, waivers, sources, staffRows, leadForms, spam] = await Promise.all([
    supabase
      .from("kiosk_devices")
      .select("id, name, activated_at, revoked_at, last_seen_at, activation_expires_at, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("waiver_templates").select("id, version, body, is_active, published_at").order("version", { ascending: false }),
    supabase.from("crm_marketing_sources").select("id, label, active, sort_order").order("sort_order"),
    supabase.from("staff").select("id, display_name, role, can_sell").is("archived_at", null).order("display_name"),
    supabase
      .from("crm_lead_forms")
      .select("id, name, how_heard_label, assigned_staff_id, revoked_at, last_received_at, submission_count")
      .order("created_at", { ascending: false }),
    supabase
      .from("crm_spam_submissions")
      .select("id, first_name, last_name, email, phone, message, reasons, created_at, released_at")
      .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (devices.error || waivers.error || sources.error || staffRows.error || leadForms.error) {
    throw new Error("Failed to load CRM settings.");
  }

  return (
    <DashboardShell title="CRM" description="Guest check-in kiosk, waiver, and sales team settings.">
      <div className="space-y-6">
        <KioskDevicesCard devices={devices.data ?? []} timezone={org.timezone} />
        <LeadFormsCard forms={leadForms.data ?? []} sources={sources.data ?? []} staff={staffRows.data ?? []} timezone={org.timezone} />
        <SpamCard
          timezone={org.timezone}
          items={(spam.data ?? []).map((row) => ({
            id: row.id as string,
            name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
            email: (row.email as string | null) ?? null,
            phone: (row.phone as string | null) ?? null,
            message: (row.message as string | null) ?? null,
            reasons: (row.reasons as string[] | null) ?? [],
            createdAt: row.created_at as string,
            released: Boolean(row.released_at),
          }))}
        />
        <WaiverCard waivers={waivers.data ?? []} timezone={org.timezone} />
        <MarketingSourcesCard sources={sources.data ?? []} />
        <SellersCard staff={staffRows.data ?? []} />
        <EmailCheckCard />
      </div>
    </DashboardShell>
  );
}
