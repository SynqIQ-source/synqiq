import { describe, expect, it } from "vitest";
import {
  compareCharges,
  expectedCharges,
  summarize,
  type BillingAdjustment,
  type ContractSchedule,
  type ReportLine,
} from "@/lib/memberships/shadow-billing";

const WINDOW = { from: "2026-11-10", to: "2026-12-31" };
const schedule = (client: string, contractId: string, autopays: [string, number][]): ContractSchedule => ({
  contractId,
  mindbodyClientId: client,
  contractName: "Adult Monthly Membership",
  autopays: autopays.map(([date, totalCents]) => ({ date, totalCents })),
});
const adjustment = (fields: Partial<BillingAdjustment> & Pick<BillingAdjustment, "kind">): BillingAdjustment => ({
  id: fields.kind + (fields.startsOn ?? ""),
  mindbodyClientId: "A",
  contractId: null,
  amountCents: null,
  percent: null,
  startsOn: "2026-11-01",
  endsOn: null,
  reason: "test",
  ...fields,
});

describe("expectedCharges", () => {
  it("sums contracts per member per day and keeps only the window", () => {
    const charges = expectedCharges(
      [
        schedule("A", "c1", [
          ["2026-11-16", 29119],
          ["2026-12-16", 29119],
          ["2027-01-16", 29119],
        ]),
        schedule("A", "c2", [["2026-11-16", 12990]]),
      ],
      [],
      WINDOW,
    );
    expect(charges.map((charge) => [charge.date, charge.cents])).toEqual([
      ["2026-11-16", 42109],
      ["2026-12-16", 29119],
    ]);
    expect(charges[0].contractIds).toEqual(["c1", "c2"]);
  });

  it("charges the payer when someone else pays", () => {
    const charges = expectedCharges(
      [schedule("P", "own", [["2026-11-16", 23707]]), { ...schedule("K", "kid", [["2026-11-16", 20459]]), payerClientId: "P" }],
      [adjustment({ kind: "discount_once", mindbodyClientId: "K", amountCents: 459 })],
      WINDOW,
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ mindbodyClientId: "P", cents: 23707 + 20000, baseCents: 44166 });
  });

  it("a freeze zeroes charges inside its dates only", () => {
    const charges = expectedCharges(
      [
        schedule("A", "c1", [
          ["2026-11-16", 29119],
          ["2026-12-16", 29119],
        ]),
      ],
      [adjustment({ kind: "freeze", startsOn: "2026-12-01", endsOn: "2026-12-31" })],
      WINDOW,
    );
    expect(charges.map((charge) => charge.cents)).toEqual([29119, 0]);
    expect(charges[1].baseCents).toBe(29119);
  });

  it("a one-time discount applies to the first charge only; ongoing to every charge", () => {
    const once = expectedCharges(
      [
        schedule("A", "c1", [
          ["2026-11-16", 20000],
          ["2026-12-16", 20000],
        ]),
      ],
      [adjustment({ kind: "discount_once", percent: 10 })],
      WINDOW,
    );
    expect(once.map((charge) => charge.cents)).toEqual([18000, 20000]);
    const ongoing = expectedCharges(
      [
        schedule("A", "c1", [
          ["2026-11-16", 20000],
          ["2026-12-16", 20000],
        ]),
      ],
      [adjustment({ kind: "discount_ongoing", amountCents: 2500 })],
      WINDOW,
    );
    expect(ongoing.map((charge) => charge.cents)).toEqual([17500, 17500]);
  });

  it("a credit is used up across charges and never goes below zero", () => {
    const charges = expectedCharges(
      [
        schedule("A", "c1", [
          ["2026-11-16", 20000],
          ["2026-12-16", 20000],
        ]),
      ],
      [adjustment({ kind: "credit", amountCents: 25000 })],
      WINDOW,
    );
    expect(charges.map((charge) => charge.cents)).toEqual([0, 15000]);
  });

  it("edits change the dues before tax; tax is recalculated at the contract's rate", () => {
    const charges = expectedCharges(
      [
        {
          contractId: "c1",
          mindbodyClientId: "A",
          contractName: "Adult",
          autopays: [
            { date: "2026-11-16", subtotalCents: 20000, taxCents: 1650, totalCents: 21650 },
            { date: "2026-12-16", subtotalCents: 20000, taxCents: 1650, totalCents: 21650 },
          ],
        },
      ],
      [adjustment({ kind: "discount_once", percent: 10 })],
      WINDOW,
    );
    expect(charges.map((charge) => [charge.subtotalCents, charge.taxCents, charge.cents, charge.baseCents])).toEqual([
      [18000, 1485, 19485, 21650],
      [20000, 1650, 21650, 21650],
    ]);
  });

  it("edits for another member or contract don't apply", () => {
    const charges = expectedCharges(
      [schedule("A", "c1", [["2026-11-16", 20000]])],
      [adjustment({ kind: "freeze", mindbodyClientId: "B" }), adjustment({ kind: "credit", amountCents: 500, contractId: "c9" })],
      WINDOW,
    );
    expect(charges[0].cents).toBe(20000);
  });
});

describe("compareCharges", () => {
  const report = (client: string | null, date: string, cents: number, status: ReportLine["status"] = "scheduled"): ReportLine => ({
    mindbodyClientId: client,
    clientName: client ? `Member ${client}` : "Unknown Person",
    date,
    cents,
    status,
  });
  const run = (expected: ReturnType<typeof expectedCharges>, lines: ReportLine[], withContracts: string[] = ["A", "B"]) =>
    compareCharges(expected, lines, { ...WINDOW, clientsWithContracts: new Set(withContracts) });

  it("matches when the member's items add up to the same total", () => {
    const expected = expectedCharges([schedule("A", "c1", [["2026-11-16", 29119]])], [], WINDOW);
    const lines = run(expected, [report("A", "2026-11-16", 29119), report("A", "2026-11-16", 0)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].reason).toBe("match");
  });

  it("explains every kind of difference", () => {
    const expected = expectedCharges(
      [
        schedule("A", "c1", [["2026-11-16", 29119]]),
        schedule("B", "c2", [
          ["2026-11-20", 20000],
          ["2026-12-20", 20000],
        ]),
      ],
      [adjustment({ kind: "discount_once", mindbodyClientId: "B", amountCents: 5000, startsOn: "2026-12-01" })],
      WINDOW,
    );
    const lines = run(
      expected,
      [
        report("A", "2026-11-16", 30000), // amount differs
        report("B", "2026-11-20", 20000), // match
        report("B", "2026-12-20", 20000), // SynqIQ discount explains it
        report(null, "2026-11-25", 10000), // not matched to a member
        report("C", "2026-11-25", 10000), // member with no contracts imported
        report("A", "2026-12-16", 29119), // A has contracts but nothing that day
        report("B", "2026-12-01", 15000, "suspended"), // frozen in Mindbody
      ],
      ["A", "B"],
    );
    const reasonFor = (client: string | null, date: string) =>
      lines.find((line) => line.date === date && line.mindbodyClientId === client)?.reason;
    expect(reasonFor("A", "2026-11-16")).toBe("amount_differs");
    expect(reasonFor("B", "2026-11-20")).toBe("match");
    expect(reasonFor("B", "2026-12-20")).toBe("changed_by_synqiq");
    expect(reasonFor(null, "2026-11-25")).toBe("member_not_matched");
    expect(reasonFor("C", "2026-11-25")).toBe("contract_not_imported");
    expect(reasonFor("A", "2026-12-16")).toBe("no_scheduled_charge");
    expect(reasonFor("B", "2026-12-01")).toBe("frozen_in_mindbody");
  });

  it("a frozen contract Mindbody skipped explains the difference", () => {
    const expected = expectedCharges(
      [
        schedule("A", "active", [["2026-11-15", 29119]]),
        { ...schedule("A", "frozen", [["2026-11-15", 20459]]), autopayStatus: "Suspended" },
      ],
      [],
      WINDOW,
    );
    const lines = run(expected, [report("A", "2026-11-15", 29119), report("A", "2026-11-15", 20459, "suspended")]);
    expect(lines[0].reason).toBe("frozen_in_mindbody");
  });

  it("flags charges SynqIQ expects that Mindbody doesn't have", () => {
    const expected = expectedCharges([schedule("A", "c1", [["2026-12-16", 29119]])], [], WINDOW);
    expect(run(expected, [])[0]).toMatchObject({ reason: "not_in_mindbody", synqiqCents: 29119, mindbodyCents: 0 });
  });

  it("summarizes totals and the match rate (frozen lines aren't counted against it)", () => {
    const expected = expectedCharges([schedule("A", "c1", [["2026-11-16", 100]])], [], WINDOW);
    const summary = summarize(run(expected, [report("A", "2026-11-16", 100), report("B", "2026-11-17", 50, "suspended")]));
    expect(summary).toMatchObject({ mindbodyCents: 100, synqiqCents: 100, matched: 1, compared: 1, matchRate: 1 });
  });
});
