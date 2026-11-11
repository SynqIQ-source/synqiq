// Pay rate math for payroll. All money is integer cents.
//
// Classes: base + per_head for each paid client above heads_above, capped at
// cap (null = no cap). A flat class rate is the same formula with per_head 0.
// Appointments: a percent of the session's value (pack price / sessions in
// the pack, so a comp session is worth $0) or a flat amount per session.

export type PayRate = {
  id: string;
  name: string;
  appliesTo: "class" | "appointment";
  method: "class_formula" | "percent" | "flat";
  baseCents: number;
  perHeadCents: number;
  headsAbove: number;
  capCents: number | null;
  percent: number | null;
  flatCents: number | null;
};

export function classPayCents(rate: PayRate, paidHeads: number): number {
  if (rate.method === "flat") return rate.flatCents ?? 0;
  const extra = Math.max(0, Math.floor(paidHeads) - rate.headsAbove);
  const total = rate.baseCents + extra * rate.perHeadCents;
  return rate.capCents == null ? total : Math.min(total, rate.capCents);
}

export function appointmentPayCents(rate: PayRate, sessionValueCents: number): number {
  if (rate.method === "flat") return rate.flatCents ?? 0;
  if (rate.method === "percent") return Math.round((Math.max(0, sessionValueCents) * (rate.percent ?? 0)) / 100);
  return 0;
}

// The rate for one class: the schedule's own assignment, else the class
// type's, else the person's default class rate.
export function resolveRate<T extends { scope: string; mindbodyId: number; payRateId: string }>(
  assignments: T[],
  candidates: { scope: string; mindbodyId: number | null | undefined }[],
  defaultRateId: string | null,
): string | null {
  for (const candidate of candidates) {
    if (candidate.mindbodyId == null) continue;
    const hit = assignments.find((a) => a.scope === candidate.scope && a.mindbodyId === candidate.mindbodyId);
    if (hit) return hit.payRateId;
  }
  return defaultRateId;
}

// Validation for the Club Admin form. Returns a message or null.
export function rateProblem(input: {
  name: string;
  appliesTo: string;
  method: string;
  baseCents: number;
  perHeadCents: number;
  headsAbove: number;
  capCents: number | null;
  percent: number | null;
  flatCents: number | null;
}): string | null {
  if (!input.name.trim()) return "Give the rate a name.";
  if (input.name.trim().length > 120) return "Keep the name under 120 characters.";
  if (input.appliesTo === "class" && !["class_formula", "flat"].includes(input.method))
    return "Classes are paid a formula or a flat amount.";
  if (input.appliesTo === "appointment" && !["percent", "flat"].includes(input.method))
    return "Sessions are paid a percent of the session's value or a flat amount.";
  if (!["class", "appointment"].includes(input.appliesTo)) return "Pick classes or sessions.";
  const money = [input.baseCents, input.perHeadCents, input.capCents ?? 0, input.flatCents ?? 0];
  if (money.some((value) => !Number.isFinite(value) || value < 0 || value > 10_000_00)) return "Amounts must be between $0 and $10,000.";
  if (!Number.isInteger(input.headsAbove) || input.headsAbove < 0 || input.headsAbove > 500) return "People included must be 0 or more.";
  if (input.method === "percent" && (input.percent == null || !(input.percent > 0) || input.percent > 100))
    return "Enter a percent between 0 and 100.";
  if (input.method === "flat" && input.flatCents == null) return "Enter the flat amount.";
  if (input.method === "class_formula" && input.capCents != null && input.capCents < input.baseCents)
    return "The cap can't be less than the base.";
  return null;
}

// "$40 + $5 per person above 6, up to $75" -- for the settings page.
export function describeRate(rate: PayRate): string {
  const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  if (rate.method === "flat") return `${money(rate.flatCents ?? 0)} ${rate.appliesTo === "class" ? "per class" : "per session"}`;
  if (rate.method === "percent") return `${rate.percent}% of the session's value`;
  if (!rate.perHeadCents) return `${money(rate.baseCents)} per class`;
  const cap = rate.capCents == null ? "" : `, up to ${money(rate.capCents)}`;
  return `${money(rate.baseCents)} + ${money(rate.perHeadCents)} per person above ${rate.headsAbove}${cap}`;
}

export function toPayRate(row: Record<string, unknown>): PayRate {
  return {
    id: row.id as string,
    name: row.name as string,
    appliesTo: row.applies_to as PayRate["appliesTo"],
    method: row.method as PayRate["method"],
    baseCents: Number(row.base_cents ?? 0),
    perHeadCents: Number(row.per_head_cents ?? 0),
    headsAbove: Number(row.heads_above ?? 0),
    capCents: row.cap_cents == null ? null : Number(row.cap_cents),
    percent: row.percent == null ? null : Number(row.percent),
    flatCents: row.flat_cents == null ? null : Number(row.flat_cents),
  };
}
