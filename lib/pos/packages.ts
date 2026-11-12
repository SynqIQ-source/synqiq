import { DateTime } from "luxon";
import type { CartLineInput } from "@/lib/pos/cart";

// Membership packages: a membership item whose first payment is made of
// parts in different revenue categories (registration fee + first month's
// dues). Each part becomes its own sale line, so revenue lands in the right
// category; the recurring parts are the monthly payment schedule.

export type PackagePart = { label: string; revenueCategoryId: string; amountCents: number; recurring: boolean };
export type PricedPart = PackagePart & { taxable: boolean };

export function parsePackageParts(value: unknown): PackagePart[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map((part) => {
    const row = (part ?? {}) as Record<string, unknown>;
    return {
      label: String(row.label ?? "").trim(),
      revenueCategoryId: String(row.revenueCategoryId ?? ""),
      amountCents: Math.round(Number(row.amountCents ?? 0)),
      recurring: row.recurring === true,
    };
  });
  return parts;
}

// Why a package can't be saved, or null. The parts must add up to the price.
export function packageProblem(parts: PackagePart[], priceCents: number, categoryIds: Set<string>): string | null {
  if (parts.length > 6) return "A package can have up to 6 parts.";
  for (const part of parts) {
    if (!part.label || part.label.length > 60) return "Give every part a name.";
    if (!categoryIds.has(part.revenueCategoryId)) return `Pick a revenue category for ${part.label}.`;
    if (!Number.isInteger(part.amountCents) || part.amountCents < 0) return `Check the amount for ${part.label}.`;
  }
  const sum = parts.reduce((total, part) => total + part.amountCents, 0);
  if (sum !== priceCents) return `The parts add up to $${(sum / 100).toFixed(2)}, not the price $${(priceCents / 100).toFixed(2)}.`;
  return null;
}

// Split cents across weights so the pieces add up exactly (largest remainder).
export function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, index) => (index === 0 ? total : 0));
  const raw = weights.map((weight) => (total * weight) / sum);
  const pieces = raw.map(Math.floor);
  let left = total - pieces.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    pieces[index] += 1;
    left -= 1;
  }
  return pieces;
}

export type SellableItem = {
  priceCents: number;
  taxable: boolean;
  categoryId: string;
  parts: PricedPart[] | null;
};
export type ExpandedLine = CartLineInput & { parentKey: string; part: PricedPart | null };

// Cart lines as sold: a package becomes one line per part (always quantity
// 1); a manual discount on the package is shared across its parts.
export function expandCartLines(
  lines: { key: string; item: SellableItem; quantity: number; manualDiscount: CartLineInput["manualDiscount"] }[],
): ExpandedLine[] {
  return lines.flatMap((line): ExpandedLine[] => {
    const { item } = line;
    if (!item.parts?.length) {
      return [
        {
          key: line.key,
          parentKey: line.key,
          part: null,
          unitPriceCents: item.priceCents,
          quantity: line.quantity,
          taxable: item.taxable,
          categoryId: item.categoryId,
          manualDiscount: line.manualDiscount ?? null,
        },
      ];
    }
    const discount = line.manualDiscount;
    const amountShares =
      discount && discount.kind === "amount"
        ? splitCents(
            Math.min(discount.value, item.priceCents),
            item.parts.map((part) => part.amountCents),
          )
        : null;
    return item.parts.map((part, index) => ({
      key: `${line.key}#${index}`,
      parentKey: line.key,
      part,
      unitPriceCents: part.amountCents,
      quantity: 1,
      taxable: part.taxable,
      categoryId: part.revenueCategoryId,
      manualDiscount:
        discount && discount.value > 0
          ? discount.kind === "percent"
            ? discount
            : amountShares![index] > 0
              ? { kind: "amount" as const, value: amountShares![index] }
              : null
          : null,
    }));
  });
}

export type Schedule = {
  lines: { label: string; revenueCategoryId: string; amountCents: number; taxable: boolean; taxCents: number }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  firstBillDate: string;
};

// The monthly payments after the sale: only the recurring parts (dues), at
// full price, starting one month after the sale date.
export function monthlySchedule(parts: PricedPart[], taxRate: number, saleDate: string): Schedule | null {
  const recurring = parts.filter((part) => part.recurring);
  if (recurring.length === 0) return null;
  const lines = recurring.map((part) => ({
    label: part.label,
    revenueCategoryId: part.revenueCategoryId,
    amountCents: part.amountCents,
    taxable: part.taxable,
    taxCents: part.taxable ? Math.round(part.amountCents * taxRate) : 0,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  return {
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    firstBillDate: DateTime.fromISO(saleDate).plus({ months: 1 }).toISODate()!,
  };
}

// "11 more monthly payments, then renews" / "monthly until cancelled".
export function scheduleTerms(autopayCount: number | null, autoRenews: boolean): string {
  if (autopayCount == null) return "monthly until cancelled";
  const count = `${autopayCount} more monthly payment${autopayCount === 1 ? "" : "s"}`;
  return autoRenews ? `${count}, then month to month` : count;
}
