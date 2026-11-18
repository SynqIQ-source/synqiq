import { describe, expect, it } from "vitest";
import { applicationFeeCents } from "@/lib/payments/checkout";
import { stripeLivemode } from "@/lib/payments/connect";

describe("card payments", () => {
  it("uses the account matching the server key's mode", () => {
    expect(stripeLivemode("sk_test_abc")).toBe(false);
    expect(stripeLivemode("sk_live_abc")).toBe(true);
    expect(stripeLivemode("rk_live_abc")).toBe(true);
    expect(stripeLivemode(undefined)).toBe(false);
  });

  it("takes no SynqIQ fee until one is set", () => {
    expect(applicationFeeCents(10_000, 0)).toBe(0);
    expect(applicationFeeCents(10_000, Number.NaN)).toBe(0);
    expect(applicationFeeCents(10_000, -5)).toBe(0);
  });

  it("rounds the fee down and caps it at 10%", () => {
    expect(applicationFeeCents(10_000, 50)).toBe(50); // 0.5% of $100
    expect(applicationFeeCents(12_345, 50)).toBe(61); // 61.725 -> 61
    expect(applicationFeeCents(10_000, 5000)).toBe(1000);
  });
});
