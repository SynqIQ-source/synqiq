import type { AdjustmentKind, BillingAdjustment } from "@/lib/memberships/shadow-billing";

// Validation and wording for SynqIQ billing edits (billing_adjustments).
// Pure, so the rules are unit-tested (tests/billing-adjustments.test.ts);
// the table's check constraints enforce the same shape.

export const ADJUSTMENT_KINDS: AdjustmentKind[] = ["credit", "discount_once", "discount_ongoing", "freeze", "cancel"];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  credit: "Dues credit",
  discount_once: "One-time discount",
  discount_ongoing: "Ongoing discount",
  freeze: "Freeze",
  cancel: "Cancellation",
};

// Why a member cancels; kept for reports.
export const CANCEL_REASONS = {
  moving: "Moving",
  switching: "Switching gyms",
  non_use: "Not using it",
  class_quality: "Class quality",
  other: "Other",
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;
export const isCancelReason = (value: unknown): value is CancelReason =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CANCEL_REASONS, value);

// Freeze lengths offered (agreements allow 1-3 months).
export const FREEZE_MONTHS = [1, 2, 3] as const;

// Last day of a freeze that starts on `startsOn` and lasts `months` months.
export function freezeEndDate(startsOn: string, months: number): string {
  const [year, month, day] = startsOn.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

export type AdjustmentInput = {
  kind?: unknown;
  contractId?: unknown;
  amountCents?: unknown;
  percent?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  reason?: unknown;
  reasonCategory?: unknown;
};

export type ValidAdjustment = {
  kind: AdjustmentKind;
  contractId: string | null;
  amountCents: number | null;
  percent: number | null;
  startsOn: string;
  endsOn: string | null;
  reason: string;
  reasonCategory: CancelReason | null;
};

const MAX_CENTS = 1_000_000; // $10,000
const MAX_FREEZE_DAYS = 366;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// `today` is the studio's local date (YYYY-MM-DD). Edits can't start in the
// past: they describe what SynqIQ will charge from now on.
export function validateAdjustment(
  input: AdjustmentInput,
  today: string,
): { ok: true; value: ValidAdjustment } | { ok: false; error: string } {
  const kind = input.kind as AdjustmentKind;
  if (!ADJUSTMENT_KINDS.includes(kind)) return { ok: false, error: "Pick a kind of change." };

  let reason = typeof input.reason === "string" ? input.reason.trim() : "";
  let reasonCategory: CancelReason | null = null;
  if (kind === "cancel") {
    if (!isCancelReason(input.reasonCategory)) return { ok: false, error: "Pick why they're cancelling." };
    reasonCategory = input.reasonCategory;
    if (!reason && reasonCategory === "other") return { ok: false, error: "Say why they're cancelling." };
    if (!reason) reason = CANCEL_REASONS[reasonCategory];
  }
  if (!reason) return { ok: false, error: "Add a reason." };
  if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };

  let contractId: string | null = null;
  if (input.contractId !== undefined && input.contractId !== null && input.contractId !== "") {
    if (typeof input.contractId !== "string" || !UUID.test(input.contractId)) return { ok: false, error: "Unknown membership." };
    contractId = input.contractId;
  }

  if (!isIsoDate(input.startsOn)) return { ok: false, error: "Pick a start date." };
  const startsOn = input.startsOn;
  if (startsOn < today) return { ok: false, error: "The start date can't be in the past." };

  let endsOn: string | null = null;
  if (input.endsOn !== undefined && input.endsOn !== null && input.endsOn !== "") {
    if (!isIsoDate(input.endsOn)) return { ok: false, error: "Pick a valid end date." };
    endsOn = input.endsOn;
    if (endsOn < startsOn)
      return {
        ok: false,
        error: "The end date must be on or after the start date.",
      };
  }

  const amountCents = input.amountCents === undefined || input.amountCents === null || input.amountCents === "" ? null : input.amountCents;
  const percent = input.percent === undefined || input.percent === null || input.percent === "" ? null : input.percent;
  if (
    amountCents !== null &&
    (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CENTS)
  ) {
    return { ok: false, error: "Enter an amount between $0.01 and $10,000." };
  }
  if (
    percent !== null &&
    (typeof percent !== "number" ||
      !Number.isFinite(percent) ||
      percent <= 0 ||
      percent > 100 ||
      Math.round(percent * 100) !== percent * 100)
  ) {
    return { ok: false, error: "Enter a percent between 0.01 and 100." };
  }

  if (kind === "credit") {
    if (amountCents === null || percent !== null) return { ok: false, error: "A credit needs a dollar amount." };
  } else if (kind === "discount_once" || kind === "discount_ongoing") {
    if ((amountCents === null) === (percent === null))
      return {
        ok: false,
        error: "A discount needs either a dollar amount or a percent.",
      };
  } else if (kind === "cancel") {
    if (amountCents !== null || percent !== null) return { ok: false, error: "A cancellation doesn't take an amount." };
    endsOn = null;
  } else {
    if (amountCents !== null || percent !== null) return { ok: false, error: "A freeze doesn't take an amount." };
    if (!endsOn) return { ok: false, error: "A freeze needs an end date." };
    if (daysBetween(startsOn, endsOn) > MAX_FREEZE_DAYS) return { ok: false, error: "A freeze can't be longer than a year." };
  }

  return {
    ok: true,
    value: {
      kind,
      contractId,
      amountCents: amountCents as number | null,
      percent: percent as number | null,
      startsOn,
      endsOn: kind === "credit" || kind === "discount_once" ? null : endsOn,
      reason,
      reasonCategory,
    },
  };
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

// "One-time discount 10%", "Dues credit $50.00", "Freeze".
export function describeAdjustment(
  adjustment: Pick<BillingAdjustment, "kind" | "amountCents" | "percent"> & { reasonCategory?: string | null },
): string {
  if (adjustment.kind === "freeze") return "Freeze";
  if (adjustment.kind === "cancel") {
    return isCancelReason(adjustment.reasonCategory) ? `Cancellation · ${CANCEL_REASONS[adjustment.reasonCategory]}` : "Cancellation";
  }
  if (adjustment.kind === "credit") return `Dues credit ${money(adjustment.amountCents ?? 0)}`;
  const amount = adjustment.percent !== null ? `${Number(adjustment.percent)}%` : money(adjustment.amountCents ?? 0);
  return `${ADJUSTMENT_LABELS[adjustment.kind]} ${amount}`;
}

// Dollars typed in a form ("49.5", "$1,200") -> cents, or null if invalid.
export function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
