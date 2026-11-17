// Inventory on hand for retail products.
//
//   on hand = the latest count (starting inventory or a recount)
//           + everything received since that count
//           - everything sold since that count (completed checkout sales;
//             practice and voided sales don't move stock)
//
// A product nobody has counted yet has no on-hand number. Deliveries
// logged before a count are already in that count, so they're ignored.

export type StockMovement = { kind: "count" | "received"; quantity: number; at: string };
export type StockSale = { quantity: number; at: string };

export type OnHand = {
  onHand: number | null; // null = not counted yet
  countedAt: string | null;
  countedQuantity: number | null;
  receivedSince: number;
  soldSince: number;
};

export function computeOnHand(movements: StockMovement[], sales: StockSale[]): OnHand {
  const counts = movements.filter((m) => m.kind === "count").sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const last = counts.at(-1) ?? null;
  if (!last) return { onHand: null, countedAt: null, countedQuantity: null, receivedSince: 0, soldSince: 0 };
  const receivedSince = movements.filter((m) => m.kind === "received" && m.at > last.at).reduce((sum, m) => sum + m.quantity, 0);
  const soldSince = sales.filter((s) => s.at > last.at).reduce((sum, s) => sum + s.quantity, 0);
  return {
    onHand: last.quantity + receivedSince - soldSince,
    countedAt: last.at,
    countedQuantity: last.quantity,
    receivedSince,
    soldSince,
  };
}

// Below or at the reorder level -> time to order; how many brings it back to PAR.
export function reorderNeed(onHand: number | null, par: number | null, reorderAt: number | null) {
  if (onHand == null || reorderAt == null) return { reorder: false, toOrder: null as number | null };
  const reorder = onHand <= reorderAt;
  return { reorder, toOrder: reorder && par != null ? Math.max(par - onHand, 0) : null };
}

export const STOCK_MAX = 100_000;
