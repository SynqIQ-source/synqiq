import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { BrandingForm } from "./branding-form";
import { TrainerHealthSettingsForm } from "./trainer-health-settings-form";
import { MindbodyWritebackForm } from "./mindbody-writeback-form";
import { PtRulesForm } from "./pt-rules-form";
import { MindbodyConnectionForm } from "./mindbody-connection-form";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DateTime } from "luxon";

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
    .select("id, name, primary_color, accent_color, secondary_color, font_family, logo_url, expected_revenue_per_session")
    .eq("id", currentStaff.organizationId)
    .single();

  if (error || !organization) {
    throw new Error(error?.message ?? "Failed to load organization.");
  }

  // Mindbody booking write-back (Dec 10 transition).
  const admin = createSupabaseAdminClient();
  const [{ data: writeback }, { count: waiting }, { data: failed }] = await Promise.all([
    admin
      .from("organizations")
      .select(
        "mindbody_booking_writeback, mindbody_writeback_until, timezone, pt_no_show_uses_session, pt_late_cancel_uses_session, pt_no_show_pay_percent, pt_late_cancel_pay_percent, trainer_sessions_pilot, session_balances_from, mindbody_disconnected_at",
      )
      .eq("id", currentStaff.organizationId)
      .maybeSingle(),
    admin
      .from("class_bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", currentStaff.organizationId)
      .eq("mindbody_sync_status", "pending"),
    admin
      .from("class_bookings")
      .select("id, client_name, mindbody_sync_error, session:class_sessions!inner ( class_name, starts_at )")
      .eq("organization_id", currentStaff.organizationId)
      .eq("mindbody_sync_status", "failed")
      .gte("session.starts_at", new Date(Date.now() - 86_400_000).toISOString())
      .limit(20)
      .returns<
        { id: string; client_name: string | null; mindbody_sync_error: string | null; session: { class_name: string; starts_at: string } }[]
      >(),
  ]);
  const zone = (writeback?.timezone as string | null) ?? "America/Chicago";

  return (
    <DashboardShell title="Settings" description="Customize your studio's branding across the dashboard.">
      <BrandingForm organization={organization} />
      <TrainerHealthSettingsForm expectedRevenuePerSession={organization.expected_revenue_per_session} />
      <PtRulesForm
        noShow={writeback?.pt_no_show_uses_session !== false}
        lateCancel={writeback?.pt_late_cancel_uses_session !== false}
        pilot={writeback?.trainer_sessions_pilot === true}
        noShowPayPercent={Number(writeback?.pt_no_show_pay_percent ?? 100)}
        lateCancelPayPercent={Number(writeback?.pt_late_cancel_pay_percent ?? 100)}
        balancesFrom={((writeback?.session_balances_from as string | null) ?? "2026-12-18").slice(0, 10)}
      />
      <MindbodyConnectionForm
        studioName={organization.name}
        disconnectedAt={(writeback?.mindbody_disconnected_at as string | null) ?? null}
      />
      <MindbodyWritebackForm
        enabled={Boolean(writeback?.mindbody_booking_writeback)}
        until={((writeback?.mindbody_writeback_until as string | null) ?? "2027-01-21").slice(0, 10)}
        waiting={waiting ?? 0}
        problems={(failed ?? []).map((row) => ({
          id: row.id,
          name: row.client_name ?? "Member",
          className: row.session.class_name,
          when: DateTime.fromISO(row.session.starts_at).setZone(zone).toFormat("ccc LLL d, h:mm a"),
          error: row.mindbody_sync_error ?? "Mindbody didn't accept it.",
        }))}
      />
    </DashboardShell>
  );
}
