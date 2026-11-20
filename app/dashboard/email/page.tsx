import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadEmailKit } from "@/lib/email/studio-kit";
import { EMAIL_TEMPLATES, TEMPLATE_KEYS } from "@/lib/email/studio-templates";
import { TemplatesEditor } from "./templates-editor";
import { DomainSettings } from "./domain-settings";

export const metadata: Metadata = { title: "Email templates" };
export const dynamic = "force-dynamic";

// Admin > Email > Templates (Club Admins): the studio's email domain, the
// header and footer on every email SynqIQ sends for the studio, and each
// email's wording.
export default async function EmailTemplatesPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (!isClubAdmin(staff)) redirect("/dashboard");
  const admin = createSupabaseAdminClient();
  const [kit, { data: org }] = await Promise.all([
    loadEmailKit(admin, staff.organizationId),
    admin
      .from("organizations")
      .select("email_from_domain, email_from_verified_at, email_relay_domain, email_relay_verified_at")
      .eq("id", staff.organizationId)
      .maybeSingle(),
  ]);
  const templates = TEMPLATE_KEYS.map((key) => ({
    key,
    label: EMAIL_TEMPLATES[key].label,
    audience: EMAIL_TEMPLATES[key].audience,
    when: EMAIL_TEMPLATES[key].when,
    customized: Boolean(kit.overrides[key]),
  }));

  return (
    <DashboardShell
      title="Email templates"
      description="The look and wording of the emails SynqIQ sends for your studio. Buttons, links and amounts are filled in automatically."
    >
      <div className="space-y-6">
        <DomainSettings
          from={{ domain: (org?.email_from_domain as string | null) ?? null, verified: Boolean(org?.email_from_verified_at) }}
          relay={{ domain: (org?.email_relay_domain as string | null) ?? null, verified: Boolean(org?.email_relay_verified_at) }}
        />
        <TemplatesEditor kit={kit} templates={templates} />
      </div>
    </DashboardShell>
  );
}
