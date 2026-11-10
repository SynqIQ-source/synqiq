import { describe, expect, it } from "vitest";
import { cleanAgreementTerms, originalStarts, toCents, toMemberContractRows, toPlanRow } from "@/lib/memberships/contracts";
import type { MindbodyClientContract } from "@/types/mindbody";

const c = (fields: MindbodyClientContract) => fields;

describe("originalStarts (renewal chains)", () => {
  it("a contract with no renewal link is its own original", () => {
    const map = originalStarts([c({ Id: 1, StartDate: "2026-03-16T00:00:00" })]);
    expect(map.get(1)).toEqual({ originalStartDate: "2026-03-16", originalClientContractId: 1 });
  });

  it("follows a two-step renewal chain back to the first contract", () => {
    const map = originalStarts([
      c({ Id: 3, StartDate: "2026-01-10T00:00:00", AutoRenewClientContractID: 2 }),
      c({ Id: 2, StartDate: "2025-01-10T00:00:00", AutoRenewClientContractID: 1 }),
      c({ Id: 1, StartDate: "2024-01-10T00:00:00" }),
    ]);
    expect(map.get(3)).toEqual({ originalStartDate: "2024-01-10", originalClientContractId: 1 });
    expect(map.get(2)?.originalStartDate).toBe("2024-01-10");
  });

  it("stops at the earliest contract we have when a link is missing", () => {
    const map = originalStarts([c({ Id: 5, StartDate: "2026-02-01T00:00:00", AutoRenewClientContractID: 4 })]);
    expect(map.get(5)).toEqual({ originalStartDate: "2026-02-01", originalClientContractId: 5 });
  });

  it("survives a cycle in bad data", () => {
    const map = originalStarts([
      c({ Id: 1, StartDate: "2025-01-01T00:00:00", AutoRenewClientContractID: 2 }),
      c({ Id: 2, StartDate: "2026-01-01T00:00:00", AutoRenewClientContractID: 1 }),
    ]);
    expect(map.get(1)?.originalClientContractId).toBeDefined();
  });

  it("falls back to the agreement date when there's no start date", () => {
    const map = originalStarts([c({ Id: 9, AgreementDate: "2025-06-01T00:00:00" })]);
    expect(map.get(9)?.originalStartDate).toBe("2025-06-01");
  });
});

describe("toMemberContractRows", () => {
  const raw = c({
    Id: 15110,
    ContractID: 101,
    ContractName: "  Adult Monthly Membership",
    PayerClientId: 100017219,
    AgreementDate: "2026-03-16T00:00:00",
    StartDate: "2026-03-16T00:00:00",
    EndDate: "2027-03-16T00:00:00",
    AutopayStatus: "Active",
    AutoRenewing: true,
    IsMonthToMonth: false,
    NormalAutoPay: 269,
    UpcomingAutopayEvents: [
      { ScheduleDate: "2026-12-16T00:00:00", ChargeAmount: 291.19, Subtotal: 269, Tax: 22.19, ProductId: 100036 },
      { ScheduleDate: "2026-11-16T00:00:00", ChargeAmount: 291.19, Subtotal: 269, Tax: 22.19, ProductId: 100036 },
    ],
  });

  it("maps dates, cents and the next bill (earliest upcoming autopay)", () => {
    const [row] = toMemberContractRows("100017219", [raw]);
    expect(row).toMatchObject({
      mindbody_client_contract_id: 15110,
      mindbody_contract_id: 101,
      contract_name: "Adult Monthly Membership",
      start_date: "2026-03-16",
      original_start_date: "2026-03-16",
      normal_autopay_cents: 26900,
      next_bill_date: "2026-11-16",
      next_bill_subtotal_cents: 26900,
      next_bill_tax_cents: 2219,
      next_bill_total_cents: 29119,
      payer_mindbody_client_id: null,
    });
    expect(row.upcoming_autopays.map((event) => event.date)).toEqual(["2026-11-16", "2026-12-16"]);
  });

  it("records a different payer", () => {
    const [row] = toMemberContractRows("100017219", [{ ...raw, PayerClientId: 555 }]);
    expect(row.payer_mindbody_client_id).toBe("555");
  });

  it("handles a contract with no upcoming autopays", () => {
    const [row] = toMemberContractRows("1", [{ ...raw, UpcomingAutopayEvents: null }]);
    expect(row.next_bill_date).toBeNull();
    expect(row.upcoming_autopays).toEqual([]);
  });
});

describe("toCents and plans", () => {
  it("rounds dollars to whole cents", () => {
    expect(toCents(291.19)).toBe(29119);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBeNull();
  });

  it("maps a contract template to a plan", () => {
    expect(
      toPlanRow({
        Id: 163,
        Name: "12 Month Commitment ",
        AutopaySchedule: { FrequencyTimeUnit: "Monthly" },
        NumberOfAutopays: 11,
        ActionUponCompletionOfAutopays: "ContractAutomaticallyRenews",
        RecurringPaymentAmountSubtotal: 219,
        FirstPaymentAmountSubtotal: 419,
        MembershipTypeRestrictions: [],
      }),
    ).toMatchObject({ name: "12 Month Commitment", recurring_subtotal_cents: 21900, number_of_autopays: 11, members_only: false });
  });
});

describe("cleanAgreementTerms", () => {
  it("drops the sample member at the top and blanks the signature block and emails", () => {
    const raw =
      "<p>ONLINE GUESTONLINE GUEST8/7/1994 someone@example.com</p><h2>Membership Privileges, Notices</h2>" +
      "<p>Membership Type: Adult Monthly Monthly Dues: $269.00</p><p>Member: JANE DOE Date: 11/9/2026 Method of Payment: Visa Last 4: 1234</p>" +
      "<p>Email memberservices@thepreservehouston.com to cancel.</p>";
    const text = cleanAgreementTerms(raw)!;
    expect(text.startsWith("Membership Privileges")).toBe(true);
    expect(text).not.toContain("someone@example.com");
    expect(text).not.toContain("JANE DOE");
    expect(text).not.toContain("1234");
    expect(text).toContain("Monthly Dues: $269.00");
    expect(text).toContain("[email]");
  });

  it("returns null for empty terms", () => {
    expect(cleanAgreementTerms("")).toBeNull();
    expect(cleanAgreementTerms(null)).toBeNull();
  });
});
