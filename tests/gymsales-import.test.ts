import { describe, expect, it } from "vitest";
import { gymSalesDate, gymSalesPhone, planGymSalesImport, type ImportContext } from "@/lib/crm/gymsales-import";

const context = (over: Partial<ImportContext> = {}): ImportContext => ({
  staffByName: new Map([["tyler watlington", "staff-tyler"]]),
  existingByEmail: new Map(),
  existingByPhone: new Map(),
  memberByEmail: new Map(),
  memberByPhone: new Map(),
  ...over,
});
const row = (over: Record<string, string> = {}) => ({
  id: "1",
  first_name: "Jane",
  last_name: "Doe",
  email: "Jane@Example.com",
  phone_mobile: "18325550100",
  phone_home: "",
  contact: "Walk In",
  source: "Google",
  status: "tour",
  salesperson: "Tyler Watlington",
  opted_out_of_sms: "No",
  opted_out_of_email: "No",
  created_at: "9/26/2026 19:37",
  updated_at: "10/1/2026 9:05",
  ...over,
});

describe("helpers", () => {
  it("reads Gym Sales dates and phones", () => {
    expect(gymSalesDate("9/26/2026 19:37")).toBe("2026-09-26T19:37:00-06:00");
    expect(gymSalesDate("4/9/1989", false)).toBe("1989-04-09");
    expect(gymSalesPhone("18325550100")).toEqual({ phone: "+18325550100", damaged: false });
    expect(gymSalesPhone("1.83255e+10")).toEqual({ phone: null, damaged: true });
  });
});

describe("planGymSalesImport", () => {
  it("maps a lead with its salesperson, source and consent", () => {
    const [c] = planGymSalesImport([row()], context()).contacts;
    expect(c).toMatchObject({
      externalRef: "gymsales:1",
      email: "jane@example.com",
      phone: "+18325550100",
      status: "lead",
      source: "walk_in",
      howHeard: ["Google"],
      assignedStaffId: "staff-tyler",
      smsConsent: true,
      emailConsent: true,
    });
  });
  it("links a sale to the current member; an unmatched sale stays a lead", () => {
    const plan = planGymSalesImport(
      [row({ id: "1", status: "sale" }), row({ id: "2", status: "sale", email: "gone@example.com", phone_mobile: "18325550199" })],
      context({ memberByEmail: new Map([["jane@example.com", "mb-1"]]) }),
    );
    expect(plan.contacts.map((c) => [c.externalRef, c.status, c.mindbodyClientId])).toEqual([
      ["gymsales:1", "member", "mb-1"],
      ["gymsales:2", "lead", null],
    ]);
    expect(plan.stats.formerSales).toBe(1);
  });
  it("keeps not-interested and opt-outs, leaves unknown salespeople unassigned", () => {
    const [c] = planGymSalesImport(
      [row({ status: "not_interested", leaving_at: "10/2/2026 10:00", salesperson: "Hashim Tayani", opted_out_of_sms: "Yes" })],
      context(),
    ).contacts;
    expect(c).toMatchObject({
      status: "not_interested",
      notInterestedAt: "2026-10-02T10:00:00-06:00",
      assignedStaffId: null,
      smsConsent: false,
    });
  });
  it("merges duplicates in the file and updates guests already in the CRM", () => {
    const plan = planGymSalesImport(
      [row({ id: "1", updated_at: "10/1/2026 9:05" }), row({ id: "2", updated_at: "11/1/2026 9:05" })],
      context({ existingByPhone: new Map([["jane|+18325550100", "crm-1"]]) }),
    );
    expect(plan.contacts).toHaveLength(1);
    expect(plan.contacts[0]).toMatchObject({ externalRef: "gymsales:2", existingId: "crm-1" });
    expect(plan.stats).toMatchObject({ duplicatesInFile: 1, updateExisting: 1, create: 0 });
  });
  it("keeps family members who share a phone or email", () => {
    const plan = planGymSalesImport(
      [row({ id: "1", first_name: "Jane" }), row({ id: "2", first_name: "John" })],
      context({ existingByPhone: new Map([["jane|+18325550100", "crm-1"]]) }),
    );
    expect(plan.contacts.map((c) => [c.externalRef, c.existingId])).toEqual([
      ["gymsales:1", "crm-1"],
      ["gymsales:2", null],
    ]);
    expect(plan.stats.duplicatesInFile).toBe(0);
  });
});
