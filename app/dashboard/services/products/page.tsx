import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureRevenueCategories } from "@/lib/pos/catalog";
import { CatalogEditor, type CatalogCategory, type CatalogItem } from "./catalog-editor";

// Services & Pricing -> Products & Inventory: everything the checkout sells
// (retail products, packs and services, memberships), each in a revenue
// category that decides tax, with a picture for its checkout card. Imported
// from Mindbody (active items only); stock counts come closer to the switch.
export default async function ProductsPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  await ensureRevenueCategories(admin, staff.organizationId);
  const [{ data: org }, { data: categories }, { data: items }] = await Promise.all([
    admin.from("organizations").select("sales_tax_rate").eq("id", staff.organizationId).maybeSingle(),
    admin
      .from("revenue_categories")
      .select("id, key, name, taxable, gl_account, active, sort")
      .eq("organization_id", staff.organizationId)
      .order("sort"),
    admin
      .from("pos_items")
      .select(
        "id, kind, source, name, price_cents, revenue_category_id, taxable, barcode, image_url, sessions, active, mindbody_name, mindbody_price_cents, mindbody_group, mindbody_discontinued, synced_at",
      )
      .eq("organization_id", staff.organizationId)
      .order("name")
      .limit(3000),
  ]);
  const categoryRows: CatalogCategory[] = (categories ?? []).map((row) => ({
    id: row.id as string,
    key: row.key as string,
    name: row.name as string,
    taxable: Boolean(row.taxable),
    glAccount: (row.gl_account as string | null) ?? "",
    active: Boolean(row.active),
  }));
  const itemRows: CatalogItem[] = (items ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as CatalogItem["kind"],
    source: row.source as string,
    name: row.name as string,
    priceCents: Number(row.price_cents),
    categoryId: (row.revenue_category_id as string | null) ?? "",
    taxable: row.taxable == null ? "category" : row.taxable ? "yes" : "no",
    barcode: (row.barcode as string | null) ?? "",
    imageUrl: (row.image_url as string | null) ?? null,
    sessions: row.sessions == null ? null : Number(row.sessions),
    active: Boolean(row.active),
    mindbodyName: (row.mindbody_name as string | null) ?? null,
    mindbodyPriceCents: row.mindbody_price_cents == null ? null : Number(row.mindbody_price_cents),
    mindbodyGroup: (row.mindbody_group as string | null) ?? null,
    mindbodyDiscontinued: Boolean(row.mindbody_discontinued),
  }));
  const lastSync =
    (items ?? [])
      .map((row) => row.synced_at as string | null)
      .filter(Boolean)
      .sort()
      .pop() ?? null;
  return (
    <DashboardShell
      title="Products & Inventory"
      description="Everything the checkout sells: retail products, packs and services, and memberships. Each item's revenue category decides whether it's taxed and where its revenue posts."
    >
      <CatalogEditor
        items={itemRows}
        categories={categoryRows}
        taxPercent={Math.round(Number(org?.sales_tax_rate ?? 0.0825) * 1_000_000) / 10_000}
        lastSync={lastSync}
      />
    </DashboardShell>
  );
}
