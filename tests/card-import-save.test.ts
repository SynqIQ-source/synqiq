import { describe, expect, it } from "vitest";
import { checkImportedCard } from "@/lib/billing/card-import-save";

const card = { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 } as never;

describe("checking a migrated card before saving it", () => {
  it("accepts a card that belongs to the customer in the file", () => {
    expect(checkImportedCard({ type: "card", customer: "cus_A", card }, "cus_A")).toEqual({
      ok: true,
      card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2029 },
    });
  });
  it("rejects a missing card, someone else's card, or something that isn't a card", () => {
    expect(checkImportedCard(null, "cus_A")).toMatchObject({ ok: false });
    expect(checkImportedCard({ type: "card", customer: "cus_B", card }, "cus_A")).toEqual({
      ok: false,
      reason: "card belongs to a different Stripe customer",
    });
    expect(checkImportedCard({ type: "us_bank_account", customer: "cus_A", card: undefined } as never, "cus_A")).toEqual({
      ok: false,
      reason: "not a card",
    });
  });
});
