import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StockMovement, StockSale } from "@/lib/pos/stock";

export { computeOnHand, reorderNeed, STOCK_MAX } from "@/lib/pos/stock";

// Loads what inventory on hand is computed from (see lib/pos/stock.ts).
type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Movements and completed sales for a studio's products, grouped by item.
export async function loadStockActivity(admin: Admin, organizationId: string) {
  const movements = new Map<string, (StockMovement & { note: string | null; staffId: string | null })[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("inventory_movements")
      .select("pos_item_id, kind, quantity, note, staff_id, created_at")
      .eq("organization_id", organizationId)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const list = movements.get(row.pos_item_id as string) ?? [];
      list.push({
        kind: row.kind as StockMovement["kind"],
        quantity: Number(row.quantity),
        at: row.created_at as string,
        note: (row.note as string | null) ?? null,
        staffId: (row.staff_id as string | null) ?? null,
      });
      movements.set(row.pos_item_id as string, list);
    }
    if (!data || data.length < 1000) break;
  }
  const sales = new Map<string, StockSale[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("pos_sale_lines")
      .select("pos_item_id, quantity, pos_sales!inner(status, created_at)")
      .eq("organization_id", organizationId)
      .eq("kind", "product")
      .eq("pos_sales.status", "completed")
      .not("pos_item_id", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const sale = (Array.isArray(row.pos_sales) ? row.pos_sales[0] : row.pos_sales) as { created_at: string } | null;
      if (!sale) continue;
      const list = sales.get(row.pos_item_id as string) ?? [];
      list.push({ quantity: Number(row.quantity), at: sale.created_at });
      sales.set(row.pos_item_id as string, list);
    }
    if (!data || data.length < 1000) break;
  }
  return { movements, sales };
}
