// Checkout math. All money is integer cents. The server recomputes every sale
// from the catalog prices with this same code; the screen uses it to preview.

export type CartLineInput = {
  key: string;
  unitPriceCents: number;
  quantity: number;
  taxable: boolean;
  categoryId: string | null;
  manualDiscount?: { kind: "percent" | "amount"; value: number } | null; // percent 0-100, or cents
};
export type PromoInput = { kind: "percent" | "amount"; percent: number | null; amountCents: number | null; categoryIds: string[] | null };
export type CartLine = CartLineInput & {
  grossCents: number;
  manualDiscountCents: number;
  promoDiscountCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
};
export type CartTotals = { lines: CartLine[]; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };

// Revenue categories whose sales earn commission (chosen per line at checkout).
export const COMMISSIONABLE_CATEGORY_KEYS = ["membership_dues", "registration_fee", "personal_training", "pilates"];

export function computeCart(input: CartLineInput[], taxRate: number, promo?: PromoInput | null): CartTotals {
  const lines = input.map((line) => {
    const quantity = Math.max(1, Math.floor(line.quantity));
    const grossCents = Math.max(0, Math.round(line.unitPriceCents)) * quantity;
    let manualDiscountCents = 0;
    if (line.manualDiscount && line.manualDiscount.value > 0) {
      manualDiscountCents =
        line.manualDiscount.kind === "percent"
          ? Math.round((grossCents * Math.min(100, line.manualDiscount.value)) / 100)
          : Math.min(grossCents, Math.round(line.manualDiscount.value));
    }
    return { ...line, quantity, grossCents, manualDiscountCents, promoDiscountCents: 0, netCents: 0, taxCents: 0, totalCents: 0 };
  });

  if (promo) {
    const eligible = lines.filter((line) => !promo.categoryIds || (line.categoryId != null && promo.categoryIds.includes(line.categoryId)));
    if (promo.kind === "percent" && promo.percent) {
      for (const line of eligible)
        line.promoDiscountCents = Math.round(((line.grossCents - line.manualDiscountCents) * promo.percent) / 100);
    } else if (promo.kind === "amount" && promo.amountCents) {
      // Spread a dollar-off code across the eligible lines by their size.
      const base = eligible.reduce((sum, line) => sum + (line.grossCents - line.manualDiscountCents), 0);
      let left = Math.min(promo.amountCents, base);
      eligible.forEach((line, index) => {
        const room = line.grossCents - line.manualDiscountCents;
        const share = index === eligible.length - 1 ? left : Math.min(room, Math.round((promo.amountCents! * room) / Math.max(1, base)));
        line.promoDiscountCents = Math.min(room, Math.max(0, share));
        left -= line.promoDiscountCents;
      });
    }
  }

  for (const line of lines) {
    line.netCents = Math.max(0, line.grossCents - line.manualDiscountCents - line.promoDiscountCents);
    line.taxCents = line.taxable ? Math.round(line.netCents * taxRate) : 0;
    line.totalCents = line.netCents + line.taxCents;
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.grossCents, 0);
  const discountCents = lines.reduce((sum, line) => sum + line.manualDiscountCents + line.promoDiscountCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  return { lines, subtotalCents, discountCents, taxCents, totalCents: subtotalCents - discountCents + taxCents };
}

// Is a promo code usable today? Returns a message, or null when it is.
export function promoProblem(
  promo: { active: boolean; starts_on: string | null; ends_on: string | null; max_uses: number | null; uses: number },
  today: string,
): string | null {
  if (!promo.active) return "That code isn't active.";
  if (promo.starts_on && promo.starts_on > today) return "That code isn't valid yet.";
  if (promo.ends_on && promo.ends_on < today) return "That code has expired.";
  if (promo.max_uses != null && promo.uses >= promo.max_uses) return "That code has been used up.";
  return null;
}
