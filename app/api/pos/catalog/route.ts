import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents, fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";
import { ensureRevenueCategories, importCatalogFromMindbody } from "@/lib/pos/catalog";
import { packageProblem, parsePackageParts } from "@/lib/pos/packages";
import { STOCK_MAX } from "@/lib/pos/stock";

export const maxDuration = 300;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// One of the studio's retail products (stock is only kept for those).
async function retailProduct(admin: Admin, org: string, id: unknown) {
  if (!isUuid(id)) return null;
  const { data } = await admin
    .from("pos_items")
    .select("id")
    .eq("id", id)
    .eq("organization_id", org)
    .eq("kind", "product")
    .is("deleted_at", null)
    .maybeSingle();
  return data as { id: string } | null;
}

// "" / null -> null (not set); a whole number in range -> it; anything else -> undefined.
function wholeNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= STOCK_MAX ? n : undefined;
}

// Products & Inventory (Club Admin). By `action`:
//   import    pull Mindbody's active catalog (read-only)
//   item      { id?, name, price, revenueCategoryId, taxable: "category"|"yes"|"no", barcode, active, kind?,
//               inventoryCategoryId?, openPrice?, membersOnly?, packageParts?: [{label, revenueCategoryId, amountCents, recurring}] | null, autopayCount?, autoRenews? }
//   itemDelete { id }  (Club Admin; soft delete)
//   inventoryCategory { id?, name, parentId?, sort }  (organizing only)
//   inventoryCategoryDelete { id }                     (its items become uncategorized)
//   category  { id, name, taxable, glAccount, active }
//   taxRate   { percent }  studio sales tax rate
//   stockLevels { id, parLevel, reorderLevel }      retail product's PAR / reorder level ("" clears)
//   stockMove   { id, kind: "count"|"received", quantity, note? }  a count (starting / recount) or a delivery
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const org = currentStaff.organizationId;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  switch (body.action) {
    case "import": {
      try {
        const summary = await importCatalogFromMindbody(org, currentStaff.id);
        return NextResponse.json({ success: true, ...summary });
      } catch (error) {
        console.error("[pos/catalog] import failed:", error);
        return fail(error instanceof Error ? error.message : "Import failed.", 500);
      }
    }
    case "item": {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 200) return fail("Give the item a name.");
      const price = dollarsToCents(body.price);
      if (price == null || Number.isNaN(price) || price < 0 || price > 10_000_000) return fail("Enter a price.");
      const barcode = String(body.barcode ?? "").trim() || null;
      if (barcode && barcode.length > 64) return fail("That barcode is too long.");
      let revenueCategoryId: string | null = null;
      if (isUuid(body.revenueCategoryId)) {
        const { data: category } = await admin
          .from("revenue_categories")
          .select("id")
          .eq("id", body.revenueCategoryId)
          .eq("organization_id", org)
          .maybeSingle();
        if (!category) return fail("Pick a revenue category.");
        revenueCategoryId = category.id as string;
      }
      if (barcode) {
        const { data: clash } = await admin
          .from("pos_items")
          .select("id, name")
          .eq("organization_id", org)
          .eq("barcode", barcode)
          .eq("active", true)
          .is("deleted_at", null)
          .neq("id", isUuid(body.id) ? body.id : "00000000-0000-0000-0000-000000000000")
          .limit(1)
          .maybeSingle();
        if (clash) return fail(`That barcode is already on ${clash.name}.`);
      }
      let inventoryCategoryId: string | null = null;
      if (isUuid(body.inventoryCategoryId)) {
        const { data: found } = await admin
          .from("inventory_categories")
          .select("id")
          .eq("id", body.inventoryCategoryId)
          .eq("organization_id", org)
          .maybeSingle();
        if (!found) return fail("Pick an inventory category.");
        inventoryCategoryId = found.id as string;
      }
      // Membership packages: parts in their own revenue categories that add up to the price.
      const kindNow = isUuid(body.id)
        ? ((await admin.from("pos_items").select("kind").eq("id", body.id).eq("organization_id", org).maybeSingle()).data?.kind as
            string | undefined)
        : String(body.kind);
      let packageParts = null as ReturnType<typeof parsePackageParts>;
      if (kindNow === "membership" && body.packageParts != null) {
        packageParts = parsePackageParts(body.packageParts);
        if (packageParts) {
          const { data: cats } = await admin.from("revenue_categories").select("id").eq("organization_id", org);
          const problem = packageProblem(packageParts, price, new Set((cats ?? []).map((row) => row.id as string)));
          if (problem) return fail(problem);
        }
      }
      const autopayCount =
        body.autopayCount === null || body.autopayCount === "" || body.autopayCount === undefined ? null : Number(body.autopayCount);
      if (autopayCount != null && (!Number.isInteger(autopayCount) || autopayCount < 0 || autopayCount > 120))
        return fail("Monthly payments must be a whole number up to 120, or blank for until cancelled.");
      const values = {
        inventory_category_id: inventoryCategoryId,
        ...(kindNow === "membership"
          ? {
              package_parts: packageParts,
              autopay_count: packageParts ? autopayCount : null,
              auto_renews: packageParts ? body.autoRenews === true : false,
            }
          : {}),
        name,
        price_cents: price,
        revenue_category_id: revenueCategoryId,
        taxable: body.taxable === "yes" ? true : body.taxable === "no" ? false : null,
        barcode,
        active: body.active !== false,
        open_price: body.openPrice === true,
        members_only: body.membersOnly === true,
        updated_at: now,
        updated_by_staff_id: currentStaff.id,
      };
      if (isUuid(body.id)) {
        const { error } = await admin.from("pos_items").update(values).eq("id", body.id).eq("organization_id", org);
        return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
      }
      const kind = ["product", "service", "membership"].includes(String(body.kind)) ? String(body.kind) : "product";
      const { data, error } = await admin
        .from("pos_items")
        .insert({ organization_id: org, kind, source: "synqiq", ...values })
        .select("id")
        .single();
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true, id: data.id });
    }
    case "itemDelete": {
      // Soft delete: gone from inventory and checkout, kept out of the next
      // Mindbody pull, and past sales still point at it.
      if (!isUuid(body.id)) return fail("Pick an item.");
      const { error } = await admin
        .from("pos_items")
        .update({ deleted_at: now, active: false, barcode: null, updated_at: now, updated_by_staff_id: currentStaff.id })
        .eq("id", body.id)
        .eq("organization_id", org);
      return error ? fail("Couldn't delete. Try again.", 500) : NextResponse.json({ success: true });
    }
    case "category": {
      if (!isUuid(body.id)) return fail("Pick a category.");
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 80) return fail("Give the category a name.");
      const glAccount = String(body.glAccount ?? "").trim() || null;
      if (glAccount && glAccount.length > 40) return fail("That account code is too long.");
      const { error } = await admin
        .from("revenue_categories")
        .update({ name, taxable: body.taxable === true, gl_account: glAccount, active: body.active !== false, updated_at: now })
        .eq("id", body.id)
        .eq("organization_id", org);
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
    }
    case "inventoryCategory": {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 60) return fail("Give the category a name.");
      let parentId: string | null = null;
      if (isUuid(body.parentId)) {
        const { data: parent } = await admin
          .from("inventory_categories")
          .select("id, parent_id")
          .eq("id", body.parentId)
          .eq("organization_id", org)
          .maybeSingle();
        if (!parent || parent.id === body.id) return fail("Pick the category it goes in.");
        if (parent.parent_id) return fail("Sub-categories can't have their own sub-categories.");
        parentId = parent.id as string;
      }
      if (isUuid(body.id) && parentId) {
        const { count } = await admin.from("inventory_categories").select("id", { count: "exact", head: true }).eq("parent_id", body.id);
        if (count) return fail("This category has sub-categories, so it can't become a sub-category.");
      }
      const values = { name, parent_id: parentId, sort: Math.round(Number(body.sort) || 0), updated_at: now };
      if (isUuid(body.id)) {
        const { error } = await admin.from("inventory_categories").update(values).eq("id", body.id).eq("organization_id", org);
        return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
      }
      const { data, error } = await admin
        .from("inventory_categories")
        .insert({ organization_id: org, ...values })
        .select("id")
        .single();
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true, id: data.id });
    }
    case "inventoryCategoryDelete": {
      if (!isUuid(body.id)) return fail("Pick a category.");
      const { count } = await admin.from("inventory_categories").select("id", { count: "exact", head: true }).eq("parent_id", body.id);
      if (count) return fail("Delete or move its sub-categories first.");
      const { error } = await admin.from("inventory_categories").delete().eq("id", body.id).eq("organization_id", org);
      return error ? fail("Couldn't delete. Try again.", 500) : NextResponse.json({ success: true });
    }
    case "taxRate": {
      const percent = Number(body.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent >= 20) return fail("Enter a tax rate between 0% and 20%.");
      const { error } = await admin
        .from("organizations")
        .update({ sales_tax_rate: Math.round(percent * 10000) / 1_000_000 })
        .eq("id", org);
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
    }
    case "ensureCategories": {
      await ensureRevenueCategories(admin, org);
      return NextResponse.json({ success: true });
    }
    case "stockLevels": {
      const product = await retailProduct(admin, org, body.id);
      if (!product) return fail("Pick a retail product.");
      const par = wholeNumber(body.parLevel);
      const reorderAt = wholeNumber(body.reorderLevel);
      if (par === undefined || reorderAt === undefined) return fail(`Enter whole numbers from 0 to ${STOCK_MAX.toLocaleString()}.`);
      if (par != null && reorderAt != null && reorderAt >= par) return fail("The reorder level should be below PAR.");
      const { error } = await admin
        .from("pos_items")
        .update({ par_level: par, reorder_level: reorderAt, updated_at: now })
        .eq("id", product.id)
        .eq("organization_id", org);
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
    }
    case "stockMove": {
      const product = await retailProduct(admin, org, body.id);
      if (!product) return fail("Pick a retail product.");
      const kind = body.kind === "count" ? "count" : body.kind === "received" ? "received" : null;
      if (!kind) return fail("Pick received or counted.");
      const quantity = wholeNumber(body.quantity);
      if (quantity == null) return fail(`Enter a whole number from 0 to ${STOCK_MAX.toLocaleString()}.`);
      if (kind === "received" && quantity === 0) return fail("Enter how many came in.");
      const note =
        String(body.note ?? "")
          .trim()
          .slice(0, 500) || null;
      const { error } = await admin.from("inventory_movements").insert({
        organization_id: org,
        pos_item_id: product.id,
        kind,
        quantity,
        note,
        staff_id: currentStaff.id,
      });
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
    }
    default:
      return fail("Unknown action.");
  }
}
