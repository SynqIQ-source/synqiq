import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CONNECT_RESPONSIBILITIES, connectCreationAllowed, readinessFrom } from "@/lib/payments/connect";

const account = (status: string | undefined, entries: { description: string; minimum_deadline: { status: string } }[] = []) =>
  ({
    id: "acct_test",
    configuration: status ? { merchant: { capabilities: { card_payments: { status } } } } : undefined,
    requirements: { entries },
  }) as unknown as Stripe.V2.Core.Account;

describe("studio Stripe account readiness", () => {
  it("is ready only when card payments are active and nothing is due", () => {
    expect(readinessFrom(account("active"))).toEqual({ cardPaymentsStatus: "active", ready: true, requirementsDue: [] });
    expect(readinessFrom(account("pending")).ready).toBe(false);
    expect(readinessFrom(account(undefined)).ready).toBe(false);
    const due = readinessFrom(account("active", [{ description: "Bank account", minimum_deadline: { status: "currently_due" } }]));
    expect(due).toMatchObject({ ready: false, requirementsDue: ["Bank account"] });
    const later = readinessFrom(account("active", [{ description: "ID document", minimum_deadline: { status: "eventually_due" } }]));
    expect(later.ready).toBe(true);
  });
  it("uses Stripe as fees and losses collector (Standard-style)", () => {
    expect(CONNECT_RESPONSIBILITIES).toEqual({ fees_collector: "stripe", losses_collector: "stripe" });
  });
});

describe("creating studio accounts", () => {
  const before = process.env.STRIPE_CONNECT_LIVE;
  afterEach(() => {
    process.env.STRIPE_CONNECT_LIVE = before;
  });
  it("always allows test mode, and live only when switched on", () => {
    expect(connectCreationAllowed("sk_test_abc")).toBe(true);
    delete process.env.STRIPE_CONNECT_LIVE;
    expect(connectCreationAllowed("sk_live_abc")).toBe(false);
    process.env.STRIPE_CONNECT_LIVE = "true";
    expect(connectCreationAllowed("sk_live_abc")).toBe(true);
    expect(connectCreationAllowed(undefined)).toBe(false);
  });
});
