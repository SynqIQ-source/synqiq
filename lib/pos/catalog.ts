import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";

// What the checkout sells, and the revenue categories (chart of accounts)
// that decide tax. Imported read-only from Mindbody; never written back.

export const DEFAULT_REVENUE_CATEGORIES = [
  { key: "drinks", name: "Drinks", taxable: true },
  { key: "gym_pass", name: "Gym Pass", taxable: false },
  { key: "membership_dues", name: "Membership Dues", taxable: true },
  { key: "merchandise", name: "Merchandise Sales", taxable: true },
  { key: "nutritional", name: "Nutritional Products", taxable: false },
  { key: "personal_training", name: "Personal Training", taxable: false },
  { key: "pilates", name: "Pilates", taxable: false },
  { key: "registration_fee", name: "Registration Fee", taxable: false },
  { key: "water", name: "Water", taxable: false },
] as const;
export type RevenueCategoryKey = (typeof DEFAULT_REVENUE_CATEGORIES)[number]["key"];

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function ensureRevenueCategories(admin: Admin, organizationId: string) {
  const { data: existing } = await admin.from("revenue_categories").select("key").eq("organization_id", organizationId);
  const have = new Set((existing ?? []).map((row) => row.key as string));
  const missing = DEFAULT_REVENUE_CATEGORIES.map((category, index) => ({ ...category, sort: index * 10 }))
    .filter((category) => !have.has(category.key))
    .map((category) => ({
      organization_id: organizationId,
      key: category.key,
      name: category.name,
      taxable: category.taxable,
      sort: category.sort,
    }));
  if (missing.length) await admin.from("revenue_categories").insert(missing);
}

// First guess at an item's revenue category from Mindbody's name and group.
// null = needs a Club Admin to pick.
export function guessRevenueCategory(
  kind: "product" | "service" | "membership",
  name: string,
  group: string | null,
): RevenueCategoryKey | null {
  const text = name.toLowerCase();
  const g = (group ?? "").toLowerCase();
  if (/(registration|enrol?lment)\s*fee/.test(text)) return "registration_fee";
  if (/termination|pool lanes/.test(text)) return null;
  if (kind === "membership") {
    // Mindbody sells PT and Pilates packages on autopay as contracts too.
    if (/(^|[^a-z])pt([^a-z]|$)|semi[- ]?private|personal training/.test(text)) return "personal_training";
    if (/pilates|reformer/.test(text) && !/trial|intro/.test(text)) return "pilates";
    return "membership_dues";
  }
  if (kind === "service") {
    if (/membership dues/.test(g) || /membership/.test(text)) return "membership_dues";
    if (/gym pass|day pass|guest pass/.test(g) || /(day|guest) pass/.test(text)) return "gym_pass";
    if (/reformer|pilates/.test(g) || /pilates|reformer/.test(text)) return "pilates";
    if (/personal training/.test(g) || /(^|[^a-z])pt([^a-z]|$)|semi[- ]?private|personal training/.test(text)) return "personal_training";
    return null;
  }
  if (
    /vitamin ?water|celsius|bang|vpx|uptime|gatorade|coke|soda|synergy|kombucha|spindrift|colombe|lmnt|hydration|coconut|bloom|red ?bull|monster|juice|tea\b|coffee/.test(
      text,
    )
  )
    return "drinks";
  if (/essentia|smart ?water|topo|\bwater\b/.test(text)) return "water";
  if (
    /barebells|quest|iconic|fairlife|core power|owyn|mush|p3 |cheese|egg|yogurt|siggi|sabra|starkist|tuna|protein|bar\b|jerky|nuts|chips/.test(
      text,
    )
  )
    return "nutritional";
  return "merchandise";
}

const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);

export type ImportSummary = {
  products: number;
  services: number;
  memberships: number;
  added: number;
  updated: number;
  deactivated: number;
};

// Pull Mindbody's active catalog. "Active": not discontinued in Mindbody, or
// sold in the last 90 days (Mindbody marks some packs discontinued that are
// still sold every day). Memberships come from the synced membership plans.
export async function importCatalogFromMindbody(organizationId: string, staffId: string | null): Promise<ImportSummary> {
  const admin = createSupabaseAdminClient();
  await ensureRevenueCategories(admin, organizationId);
  const [{ data: org }, { data: categories }] = await Promise.all([
    admin.from("organizations").select("mindbody_site_id").eq("id", organizationId).maybeSingle(),
    admin.from("revenue_categories").select("id, key").eq("organization_id", organizationId),
  ]);
  if (!org?.mindbody_site_id) throw new Error("This studio isn't connected to Mindbody.");
  const categoryId = new Map((categories ?? []).map((row) => [row.key as string, row.id as string]));
  const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) }) as unknown as {
    requireAccessToken: () => Promise<string>;
    request: (path: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const token = await mindbody.requireAccessToken();
  const page = async (path: string, key: string, extra: Record<string, unknown> = {}) => {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ;) {
      const result = await mindbody.request(path, {
        method: "GET",
        accessToken: token,
        searchParams: { Limit: 200, Offset: offset, ...extra },
      });
      const list = (result[key] as Record<string, unknown>[]) ?? [];
      rows.push(...list);
      offset += list.length;
      const total = (result.PaginationResponse as { TotalResults?: number } | undefined)?.TotalResults ?? 0;
      if (list.length === 0 || offset >= total) return rows;
    }
  };
  const [products, services, plans] = await Promise.all([
    page("/sale/products", "Products"),
    page("/sale/services", "Services", { IncludeDiscontinued: true }),
    admin
      .from("membership_plans")
      .select("mindbody_contract_id, name, first_payment_subtotal_cents, recurring_subtotal_cents, active")
      .eq("organization_id", organizationId),
  ]);
  // Products sold recently (member_sale_items has no date; join through sales).
  const { data: recentSales } = await admin
    .from("member_sales")
    .select("mindbody_sale_id")
    .eq("organization_id", organizationId)
    .gte("sale_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
    .limit(20000);
  const recentSaleIds = new Set((recentSales ?? []).map((row) => Number(row.mindbody_sale_id)));
  const soldRecently = new Set<number>();
  if (recentSaleIds.size) {
    const ids = [...recentSaleIds];
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await admin
        .from("member_sale_items")
        .select("product_id")
        .eq("organization_id", organizationId)
        .in("mindbody_sale_id", ids.slice(i, i + 500))
        .not("product_id", "is", null);
      (data ?? []).forEach((row) => soldRecently.add(Number(row.product_id)));
    }
  }

  type Row = {
    kind: "product" | "service" | "membership";
    mindbody_id: string;
    name: string;
    price_cents: number;
    tax_rate: number | null;
    barcode: string | null;
    group: string | null;
    sessions: number | null;
    discontinued: boolean;
  };
  const rows: Row[] = [];
  for (const product of products) {
    rows.push({
      kind: "product",
      mindbody_id: String(product.ProductId),
      name: String(product.Name ?? "").trim(),
      price_cents: cents(product.Price),
      tax_rate: product.TaxRate == null ? null : Number(product.TaxRate),
      barcode: product.Id ? String(product.Id) : null,
      group: product.CategoryId != null ? `Category ${product.CategoryId}` : null,
      sessions: null,
      discontinued: false,
    });
  }
  for (const service of services) {
    const discontinued = Boolean(service.Discontinued);
    if (discontinued && !soldRecently.has(Number(service.ProductId ?? service.Id))) continue;
    rows.push({
      kind: "service",
      mindbody_id: String(service.Id),
      name: String(service.Name ?? "").trim(),
      price_cents: cents(service.Price),
      tax_rate: service.TaxRate == null ? null : Number(service.TaxRate),
      barcode: null,
      group: [service.Program, service.RevenueCategory].filter(Boolean).join(" · ") || null,
      sessions: service.Count == null ? null : Number(service.Count),
      discontinued,
    });
  }
  for (const plan of plans.data ?? []) {
    if (!plan.active) continue;
    rows.push({
      kind: "membership",
      mindbody_id: String(plan.mindbody_contract_id),
      name: String(plan.name ?? "").trim(),
      price_cents: Number(plan.first_payment_subtotal_cents ?? plan.recurring_subtotal_cents ?? 0),
      tax_rate: null,
      barcode: null,
      group: "Membership",
      sessions: null,
      discontinued: false,
    });
  }

  const { data: existing } = await admin
    .from("pos_items")
    .select("id, kind, mindbody_id, active, source")
    .eq("organization_id", organizationId)
    .eq("source", "mindbody");
  const existingBy = new Map((existing ?? []).map((row) => [`${row.kind}|${row.mindbody_id}`, row]));
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const mirror = {
      mindbody_name: row.name,
      mindbody_price_cents: row.price_cents,
      mindbody_tax_rate: row.tax_rate,
      mindbody_group: row.group,
      mindbody_discontinued: row.discontinued,
      synced_at: now,
    };
    const found = existingBy.get(`${row.kind}|${row.mindbody_id}`);
    if (found) {
      await admin.from("pos_items").update(mirror).eq("id", found.id);
      updated += 1;
      continue;
    }
    const guess = guessRevenueCategory(row.kind, row.name, row.group);
    const { error } = await admin.from("pos_items").insert({
      organization_id: organizationId,
      kind: row.kind,
      source: "mindbody",
      mindbody_id: row.mindbody_id,
      name: row.name || "Unnamed item",
      price_cents: row.price_cents,
      revenue_category_id: guess ? (categoryId.get(guess) ?? null) : null,
      barcode: row.barcode,
      sessions: row.sessions,
      active: true,
      updated_by_staff_id: staffId,
      ...mirror,
    });
    if (!error) added += 1;
  }
  // Mindbody items no longer active there: hide them (kept for history).
  const seen = new Set(rows.map((row) => `${row.kind}|${row.mindbody_id}`));
  const stale = (existing ?? []).filter((row) => row.active && !seen.has(`${row.kind}|${row.mindbody_id}`)).map((row) => row.id as string);
  if (stale.length) await admin.from("pos_items").update({ active: false, updated_at: now }).in("id", stale);
  return {
    products: rows.filter((row) => row.kind === "product").length,
    services: rows.filter((row) => row.kind === "service").length,
    memberships: rows.filter((row) => row.kind === "membership").length,
    added,
    updated,
    deactivated: stale.length,
  };
}

// Tax for one item: its own setting, else its category's.
export function isTaxable(item: { taxable: boolean | null }, category: { taxable: boolean } | null | undefined): boolean {
  return item.taxable ?? category?.taxable ?? false;
}
