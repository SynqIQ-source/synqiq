// Sales tax on membership dues. SynqIQ edits and price increases change the
// dues before tax (the base rate); tax is never edited directly, it follows
// the contract's own rate as Mindbody charges it today.

type TaxSource = {
  nextBillSubtotalCents: number | null;
  nextBillTaxCents: number | null;
  autopays?: { subtotalCents?: number | null; taxCents?: number | null }[] | null;
};

// Tax rate as a fraction (0.0825), from the next bill or else the first
// scheduled autopay that splits out tax; null when unknown.
export function contractTaxRate(source: TaxSource): number | null {
  if (source.nextBillSubtotalCents && source.nextBillSubtotalCents > 0 && source.nextBillTaxCents !== null) {
    return source.nextBillTaxCents / source.nextBillSubtotalCents;
  }
  for (const autopay of source.autopays ?? []) {
    if (typeof autopay.subtotalCents === "number" && autopay.subtotalCents > 0 && typeof autopay.taxCents === "number") {
      return autopay.taxCents / autopay.subtotalCents;
    }
  }
  return null;
}

export const taxOn = (baseCents: number, rate: number | null): number | null => (rate === null ? null : Math.round(baseCents * rate));

// "8.25%"
export const formatTaxRate = (rate: number | null) =>
  rate === null ? "—" : `${(Math.round(rate * 10000) / 100).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
