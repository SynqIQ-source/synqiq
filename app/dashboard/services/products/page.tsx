import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureRevenueCategories } from "@/lib/pos/catalog";
import { CatalogEditor, type CatalogCategory, type CatalogItem, type InventoryCategory } from "./catalog-editor";
import { parsePackageParts } from "@/lib/pos/packages";
import { computeOnHand, loadStockActivity } from "@/lib/pos/inventory";
import type { StockRow } from "./stock-on-hand";

// Services & Pricing -> Products & Inventory: everything the checkout sells
// (retail products, packs and services, memberships), each in a revenue
// category that decides tax, with a picture for its checkout card. Imported
// from Mindbody (active items only). Inventory on hand: PAR, reorder level
// and counts/deliveries for retail products (lib/pos/inventory.ts).
export default async function ProductsPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  await ensureRevenueCategories(admin, staff.organizationId);
  const [{ data: org }, { data: categories }, { data: items }, { data: promos }, { data: invCats }] = await Promise.all([
    admin.from("organizations").select("sales_tax_rate").eq("id", staff.organizationId).maybeSingle(),
    admin
      .from("revenue_categories")
      .select("id, key, name, taxable, gl_account, active, sort")
      .eq("organization_id", staff.organizationId)
      .order("sort"),
    admin
      .from("pos_items")
      .select(
        "id, kind, source, name, price_cents, revenue_category_id, taxable, barcode, image_url, sessions, active, mindbody_name, mindbody_price_cents, mindbody_group, mindbody_discontinued, synced_at, inventory_category_id, package_parts, autopay_count, auto_renews, open_price, members_only, par_level, reorder_level",
      )
      .eq("organization_id", staff.organizationId)
      .is("deleted_at", null)
      .order("name")
      .limit(3000),
    admin
      .from("promo_codes")
      .select("id, code, kind, percent, amount_cents, revenue_category_ids, starts_on, ends_on, max_uses, uses, note")
      .eq("organization_id", staff.organizationId)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    admin.from("inventory_categories").select("id, parent_id, name, sort").eq("organization_id", staff.organizationId).order("sort"),
  ]);
  const inventoryCategories: InventoryCategory[] = (invCats ?? []).map((row) => ({
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    name: row.name as string,
    sort: Number(row.sort ?? 0),
  }));
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
    inventoryCategoryId: (row.inventory_category_id as string | null) ?? "",
    packageParts: parsePackageParts(row.package_parts),
    autopayCount: row.autopay_count == null ? null : Number(row.autopay_count),
    autoRenews: Boolean(row.auto_renews),
    openPrice: Boolean(row.open_price),
    membersOnly: Boolean(row.members_only),
  }));
  // Inventory on hand: active retail products.
  const stockActivity = await loadStockActivity(admin, staff.organizationId);
  const staffIds = [
    ...new Set(
      [...stockActivity.movements.values()]
        .flat()
        .map((m) => m.staffId)
        .filter(Boolean),
    ),
  ] as string[];
  const { data: staffRows } = staffIds.length
    ? await admin.from("staff").select("id, first_name, last_name").in("id", staffIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  const stock: StockRow[] = (items ?? [])
    .filter((row) => row.kind === "product" && row.active)
    .map((row) => {
      const movements = stockActivity.movements.get(row.id as string) ?? [];
      const onHand = computeOnHand(movements, stockActivity.sales.get(row.id as string) ?? []);
      return {
        id: row.id as string,
        name: row.name as string,
        inventoryCategoryId: (row.inventory_category_id as string | null) ?? null,
        parLevel: row.par_level == null ? null : Number(row.par_level),
        reorderLevel: row.reorder_level == null ? null : Number(row.reorder_level),
        ...onHand,
        history: movements
          .slice(-6)
          .reverse()
          .map((m) => ({
            kind: m.kind,
            quantity: m.quantity,
            at: m.at,
            note: m.note,
            by: m.staffId ? (staffName.get(m.staffId) ?? null) : null,
          })),
      };
    });
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
        inventoryCategories={inventoryCategories}
        taxPercent={Math.round(Number(org?.sales_tax_rate ?? 0.0825) * 1_000_000) / 10_000}
        lastSync={lastSync}
        stock={stock}
        promos={(promos ?? []).map((row) => ({
          id: row.id as string,
          code: row.code as string,
          kind: row.kind as "percent" | "amount",
          percent: row.percent == null ? null : Number(row.percent),
          amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
          categoryIds: (row.revenue_category_ids as string[] | null) ?? null,
          startsOn: (row.starts_on as string | null) ?? null,
          endsOn: (row.ends_on as string | null) ?? null,
          maxUses: row.max_uses == null ? null : Number(row.max_uses),
          uses: Number(row.uses ?? 0),
          note: (row.note as string | null) ?? null,
        }))}
      />
    </DashboardShell>
  );
}
