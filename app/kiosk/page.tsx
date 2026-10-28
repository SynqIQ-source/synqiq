import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getKioskDevice } from "@/lib/crm/kiosk-auth";
import { getCrmOrg } from "@/lib/crm/org";
import { brandStyleVars, getOrgBranding } from "@/lib/org-branding";
import { KioskActivate } from "./kiosk-activate";
import { KioskFlow, type KioskConfig } from "./kiosk-flow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guest check-in",
  robots: { index: false, follow: false },
};

// Full-screen guest check-in for a paired iPad. No staff login and no staff
// navigation: the device's own token (httpOnly cookie) decides which
// organization this is. The page only ever receives what the form needs --
// the org's branding, its "how did you hear" options, seller names and the
// active waiver text -- never any guest or member data.
export default async function KioskPage() {
  const device = await getKioskDevice();
  if (!device) {
    return <KioskActivate />;
  }

  const admin = createSupabaseAdminClient();
  const [org, branding, sources, sellers, waiver] = await Promise.all([
    getCrmOrg(device.organizationId),
    getOrgBranding(device.organizationId),
    admin
      .from("crm_marketing_sources")
      .select("label")
      .eq("organization_id", device.organizationId)
      .eq("active", true)
      .order("sort_order"),
    admin
      .from("staff")
      .select("id, display_name")
      .eq("organization_id", device.organizationId)
      .eq("can_sell", true)
      .is("archived_at", null)
      .order("display_name"),
    admin
      .from("waiver_templates")
      .select("id, version, body")
      .eq("organization_id", device.organizationId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const config: KioskConfig = {
    organizationName: branding?.name ?? org.name,
    logoUrl: branding?.logo_url ?? null,
    sources: (sources.data ?? []).map((row) => row.label),
    sellers: (sellers.data ?? []).map((row) => ({ id: row.id, name: row.display_name })),
    waiver: waiver.data ?? null,
  };

  const style = branding ? brandStyleVars(branding) : {};

  return (
    <div style={{ ...style, fontFamily: "var(--font-body)" } as React.CSSProperties}>
      <KioskFlow config={config} />
    </div>
  );
}
