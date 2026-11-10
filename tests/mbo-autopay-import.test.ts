import { describe, expect, it } from "vitest";
import { nameKey, parseBilling, parseClientName, parseStatus } from "@/lib/imports/definitions/mbo-autopay";

describe("AutoPay Detail parsing", () => {
  it("reads 'Last, First' names with Mindbody's non-breaking spaces", () => {
    expect(parseClientName("Alvarado, Jason")).toEqual({ first: "Jason", last: "Alvarado", display: "Jason Alvarado" });
    expect(parseClientName("Ballard-Downs, Maya")).toMatchObject({ last: "Ballard-Downs", first: "Maya" });
    expect(parseClientName("Cher")).toEqual({ first: "Cher", last: "", display: "Cher" });
    expect(nameKey(" Jason ", "Alvarado")).toBe("jason alvarado");
  });

  it("keeps only card brand, last 4 and expiry", () => {
    expect(parseBilling("Visa xxxx9423 Exp 03/30")).toEqual({ brand: "Visa", last4: "9423", expMonth: 3, expYear: 2030 });
    expect(parseBilling("American Express xxxx2019 Exp 10/28")).toEqual({
      brand: "American Express",
      last4: "2019",
      expMonth: 10,
      expYear: 2028,
    });
    expect(parseBilling("Master Card xxxxxxxx Exp 03/29")).toEqual({ brand: "Master Card", last4: null, expMonth: 3, expYear: 2029 });
    expect(parseBilling("Visa xxxx123 Exp 01/27")).toMatchObject({ brand: "Visa", last4: "123", expMonth: 1, expYear: 2027 });
    expect(parseBilling("Debit client account")).toMatchObject({ brand: "Account balance", last4: null });
    expect(parseBilling("")).toEqual({ brand: null, last4: null, expMonth: null, expYear: null });
  });

  it("normalizes statuses and keeps decline reasons", () => {
    expect(parseStatus("Success")).toEqual({ status: "success", detail: null });
    expect(parseStatus("Scheduled")).toEqual({ status: "scheduled", detail: null });
    expect(parseStatus("Suspended")).toEqual({ status: "suspended", detail: null });
    expect(parseStatus("Declined - CardDeclined: Code: D2012. Message: Insufficient Funds.")).toEqual({
      status: "declined",
      detail: "CardDeclined: Code: D2012. Message: Insufficient Funds.",
    });
    expect(parseStatus("Declined - Credit Card is Expired").detail).toBe("Credit Card is Expired");
    expect(parseStatus("Voided").status).toBe("other");
  });
});
