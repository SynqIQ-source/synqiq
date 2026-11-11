import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents, fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";
import { ensureRevenueCategories, importCatalogFromMindbody } from "@/lib/pos/catalog";

export const maxDuration = 300;

// Products & Inventory (Club Admin). By `action`:
//   import    pull Mindbody's active catalog (read-only)
//   item      { id?, name, price, revenueCategoryId, taxable: "category"|"yes"|"no", barcode, active, kind? }
//   category  { id, name, taxable, glAccount, active }
//   taxRate   { percent }  studio sales tax rate
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
          .neq("id", isUuid(body.id) ? body.id : "00000000-0000-0000-0000-000000000000")
          .limit(1)
          .maybeSingle();
        if (clash) return fail(`That barcode is already on ${clash.name}.`);
      }
      const values = {
        name,
        price_cents: price,
        revenue_category_id: revenueCategoryId,
        taxable: body.taxable === "yes" ? true : body.taxable === "no" ? false : null,
        barcode,
        active: body.active !== false,
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
    default:
      return fail("Unknown action.");
  }
}
