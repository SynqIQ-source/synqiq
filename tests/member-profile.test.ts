import { describe, expect, it } from "vitest";
import { isUnlimited, toSaleRows, toServiceRow, toVisitRow, visitKind } from "@/lib/memberships/profile";

const ORG = "org";

describe("visits", () => {
  it("tells arrivals, classes and appointments apart", () => {
    expect(visitKind({ Name: "Arrival", ClassId: 0, AppointmentId: 0 })).toBe("arrival");
    expect(visitKind({ Name: "Hustle and Core", ClassId: 51234, AppointmentId: 0 })).toBe("class");
    expect(visitKind({ Name: "Personal Training 50min", ClassId: 0, AppointmentId: 194036 })).toBe("appointment");
    expect(visitKind({ Name: "Something", ClassId: 0, AppointmentId: 0 })).toBe("other");
  });

  it("keeps studio-local times and drops empty ids", () => {
    const row = toVisitRow(ORG, "561", {
      Id: 9,
      Name: "Personal Training 50min",
      StartDateTime: "2026-11-10T06:30:00",
      EndDateTime: "2026-11-10T07:20:00",
      AppointmentId: 194036,
      ClassId: 0,
      AppointmentStatus: "Booked",
      StaffId: 0,
      SignedIn: false,
    });
    expect(row).toMatchObject({
      kind: "appointment",
      start_local: "2026-11-10T06:30:00",
      end_local: "2026-11-10T07:20:00",
      appointment_id: 194036,
      class_id: null,
      staff_mindbody_id: null,
      appointment_status: "Booked",
    });
    expect(toVisitRow(ORG, "561", { Id: 10, StartDateTime: null })).toBeNull();
  });
});

describe("purchases", () => {
  it("makes one sale per receipt and one row per line, even though Mindbody repeats the sale per line", () => {
    const sale = {
      Id: 77,
      SaleDateTime: "2025-11-28T15:42:31Z",
      SalesRepId: 5,
      LocationId: 1,
      PurchasedItems: [
        {
          SaleDetailId: 1,
          Id: 100290,
          Description: "Go Macro",
          UnitPrice: 3.5,
          Quantity: 1,
          TaxAmount: 0,
          TotalAmount: 3.5,
          Returned: false,
        },
        {
          SaleDetailId: 2,
          Id: 100291,
          Description: "Smoothie",
          UnitPrice: 4,
          Quantity: 1,
          TaxAmount: 0.32,
          TotalAmount: 4.32,
          Returned: false,
        },
      ],
      Payments: [{ Method: 2, Type: "Visa/MC", Amount: 7.82 }],
    };
    const { sales, items } = toSaleRows(ORG, "561", [{ Sale: sale }, { Sale: sale }]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      mindbody_sale_id: 77,
      total_cents: 782,
      payments: [{ method: 2, type: "Visa/MC", amountCents: 782 }],
    });
    expect(items.map((item) => [item.mindbody_sale_detail_id, item.description, item.tax_cents, item.total_cents])).toEqual([
      [1, "Go Macro", 0, 350],
      [2, "Smoothie", 32, 432],
    ]);
  });
});

describe("services", () => {
  it("keeps sessions bought vs left and spots unlimited passes", () => {
    const row = toServiceRow(ORG, "561", {
      Id: 5,
      Name: "PT 60 Single Session (add-on)",
      Program: { Name: "Personal Training" },
      Count: 16,
      Remaining: 13,
      Current: true,
      ActiveDate: "2026-10-22T00:00:00",
      ExpirationDate: "2027-04-22T00:00:00",
    });
    expect(row).toMatchObject({
      count: 16,
      remaining: 13,
      program: "Personal Training",
      active_date: "2026-10-22",
      expiration_date: "2027-04-22",
    });
    expect(isUnlimited(16)).toBe(false);
    expect(isUnlimited(999999)).toBe(true);
  });
});
