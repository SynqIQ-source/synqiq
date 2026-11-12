import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/require-access";
import { canCheckout, canDiscountAtCheckout } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureRevenueCategories, isTaxable } from "@/lib/pos/catalog";
import { COMMISSIONABLE_CATEGORY_KEYS } from "@/lib/pos/cart";
import { FREEZE_NOTICE } from "@/lib/memberships/freeze-check";
import { parsePackageParts } from "@/lib/pos/packages";
import { Checkout, type CheckoutCategory, type CheckoutItem, type CheckoutShelf } from "./checkout";

// Checkout (POS), PRACTICE MODE: shelves first (Memberships, Drinks ->
// Energy drinks ...), then picture cards; a cart
// with member, discounts, promo code, tax and commission choices. Saving
// records a practice sale; no money moves until payments are connected.
export default async function PosPage() {
  const staff = await requireAccess(canCheckout);
  const admin = createSupabaseAdminClient();
  await ensureRevenueCategories(admin, staff.organizationId);
  const [{ data: org }, { data: categories }, { data: items }, { data: people }, { data: groups }] = await Promise.all([
    admin.from("organizations").select("sales_tax_rate").eq("id", staff.organizationId).maybeSingle(),
    admin
      .from("revenue_categories")
      .select("id, key, name, taxable, sort, active")
      .eq("organization_id", staff.organizationId)
      .order("sort"),
    admin
      .from("pos_items")
      .select(
        "id, kind, name, price_cents, revenue_category_id, taxable, barcode, image_url, sessions, group_id, package_parts, autopay_count, auto_renews, sort",
      )
      .eq("organization_id", staff.organizationId)
      .eq("active", true)
      .not("revenue_category_id", "is", null)
      .order("name")
      .limit(3000),
    admin
      .from("staff")
      .select("id, display_name")
      .eq("organization_id", staff.organizationId)
      .is("archived_at", null)
      .order("display_name"),
    admin
      .from("pos_groups")
      .select("id, parent_id, name, sort")
      .eq("organization_id", staff.organizationId)
      .eq("active", true)
      .order("sort"),
  ]);
  const shelves: CheckoutShelf[] = (groups ?? []).map((row) => ({
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    name: row.name as string,
  }));
  const categoryBy = new Map((categories ?? []).map((row) => [row.id as string, row]));
  const categoryRows: CheckoutCategory[] = (categories ?? [])
    .filter((row) => row.active)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      commissionable: COMMISSIONABLE_CATEGORY_KEYS.includes(row.key as string),
      key: row.key as string,
    }));
  const itemRows: CheckoutItem[] = (items ?? []).map((row) => {
    const category = categoryBy.get(row.revenue_category_id as string);
    return {
      id: row.id as string,
      kind: row.kind as CheckoutItem["kind"],
      name: row.name as string,
      priceCents: Number(row.price_cents),
      categoryId: row.revenue_category_id as string,
      taxable: isTaxable({ taxable: (row.taxable as boolean | null) ?? null }, category as { taxable: boolean } | undefined),
      barcode: (row.barcode as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      sessions: row.sessions == null ? null : Number(row.sessions),
      groupId: (row.group_id as string | null) ?? null,
      parts:
        row.kind === "membership"
          ? (parsePackageParts(row.package_parts)?.map((part) => ({
              ...part,
              taxable: Boolean(categoryBy.get(part.revenueCategoryId)?.taxable),
            })) ?? null)
          : null,
      autopayCount: row.autopay_count == null ? null : Number(row.autopay_count),
      autoRenews: Boolean(row.auto_renews),
    };
  });
  return (
    <DashboardShell
      title="Checkout"
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/pos/sales">Sales history &amp; end of day</Link>
        </Button>
      }
      description="Practice mode: sales are recorded to check the screen and the totals. No card is charged and nothing changes in Mindbody."
    >
      <Checkout
        items={itemRows}
        shelves={shelves}
        categories={categoryRows}
        taxRate={Number(org?.sales_tax_rate ?? 0.0825)}
        mayDiscount={canDiscountAtCheckout(staff)}
        people={(people ?? []).map((row) => ({ id: row.id as string, name: (row.display_name as string | null) ?? "Unknown" }))}
        me={{ id: staff.id, name: staff.displayName ?? "Me" }}
        freezeNotice={FREEZE_NOTICE}
      />
    </DashboardShell>
  );
}
