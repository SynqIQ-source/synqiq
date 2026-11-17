import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PLACEHOLDERS } from "@/lib/agreements/render";
import { AgreementsEditor } from "./agreements-editor";

export const dynamic = "force-dynamic";

// Agreements members sign at checkout (memberships, personal training).
// Club Admins edit the text (or upload it), and pick which items use which
// agreement in Products & Inventory (or here, from the item list).
export default async function AgreementsPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const [{ data: org }, { data: templates }, { data: items }, { count: signedCount }] = await Promise.all([
    admin.from("organizations").select("name, legal_name").eq("id", staff.organizationId).maybeSingle(),
    admin
      .from("agreement_templates")
      .select("id, name, body, version, updated_at")
      .eq("organization_id", staff.organizationId)
      .eq("active", true)
      .order("name"),
    admin
      .from("pos_items")
      .select("id, name, kind, agreement_template_id")
      .eq("organization_id", staff.organizationId)
      .eq("active", true)
      .is("deleted_at", null)
      .not("agreement_template_id", "is", null)
      .order("name"),
    admin.from("agreement_signatures").select("id", { count: "exact", head: true }).eq("organization_id", staff.organizationId),
  ]);

  return (
    <DashboardShell
      title="Agreements"
      description="What members read and sign at checkout when they buy a membership or a personal-training package."
    >
      <AgreementsEditor
        legalName={(org?.legal_name as string | null) ?? (org?.name as string | null) ?? ""}
        placeholders={Object.entries(PLACEHOLDERS).map(([key, label]) => ({ key, label }))}
        signedCount={signedCount ?? 0}
        templates={(templates ?? []).map((row) => ({
          id: row.id as string,
          name: row.name as string,
          body: row.body as string,
          version: Number(row.version),
          updatedAt: row.updated_at as string,
          items: (items ?? [])
            .filter((item) => item.agreement_template_id === row.id)
            .map((item) => ({ id: item.id as string, name: item.name as string })),
        }))}
      />
    </DashboardShell>
  );
}
