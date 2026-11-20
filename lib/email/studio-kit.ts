import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isTemplateKey, type EmailKit, type TemplateOverrides } from "@/lib/email/studio-templates";
import { fromAddress, studioDomains } from "@/lib/email/domains";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// A studio's email header/footer and reworded templates, for the senders.
// Falls back to the defaults on any read problem: an email must still go out.
export async function loadEmailKit(admin: Admin, organizationId: string): Promise<EmailKit> {
  const [{ data: org }, { data: settings }, { data: templates }, domains] = await Promise.all([
    admin.from("organizations").select("name, logo_url, primary_color").eq("id", organizationId).maybeSingle(),
    admin.from("email_settings").select("signature, footer, show_logo").eq("organization_id", organizationId).maybeSingle(),
    admin.from("email_templates").select("key, subject, body").eq("organization_id", organizationId),
    studioDomains(admin, organizationId),
  ]);
  const overrides: TemplateOverrides = {};
  for (const row of templates ?? []) {
    if (isTemplateKey(row.key)) overrides[row.key] = { subject: row.subject as string, body: row.body as string };
  }
  return {
    branding: {
      studioName: (org?.name as string | null) ?? "Your studio",
      logoUrl: (org?.logo_url as string | null) ?? null,
      color: (org?.primary_color as string | null) ?? "#0f766e",
      signature: (settings?.signature as string | null) ?? null,
      footer: (settings?.footer as string | null) ?? null,
      showLogo: (settings?.show_logo as boolean | null) ?? true,
    },
    overrides,
    fromDomain: domains.from,
  };
}

// "Studio <notifications@studio-domain>" once the studio's domain is verified, else synqiq.co.
export const studioFrom = (studioName: string, domain?: string | null) => fromAddress(studioName, domain);
