import { describe, expect, it } from "vitest";
import { moneyCents, parseCommissionReport } from "@/lib/payroll/mbo-commission-report";

const header =
  "Date\tItem Name\tID\t\tItem Price\tClient\t\tItem Standard %\tItem Standard Flat\tItem Promo %\tItem Promo Flat\tStaff Standard %\tStaff Standard Flat\tStaff Promo %\tStaff Promo Flat\tTotal";

describe("Mindbody commission report", () => {
  it("parses money", () => {
    expect(moneyCents("$1,600.00")).toBe(160000);
    expect(moneyCents("($50.00)")).toBe(-5000);
    expect(moneyCents("Commission")).toBeNull();
  });

  it("reads lines copied from the page (tab-separated), with splits", () => {
    const text = [
      "Tyler Watlington",
      header,
      "11/4/2026\tPT 60 16PK\t56184312740\tCommission\t$1,600.00\tA Client\t[Logs]\t$160.00\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t$160.00",
      "Total:\t$2,038.00\t\tTotal Sales:\t4\tCommission:\t$247.60",
      "Kristen Arias",
      header,
      "10/31/2026\tMonthly Membership - Adult\t100018371\tCommission2\t$269.00\tB Client\t[Logs]\t$0.00\t$0.00\t$26.90\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t$26.90",
    ].join("\n");
    expect(parseCommissionReport(text)).toEqual([
      {
        staffName: "Tyler Watlington",
        date: "2026-11-04",
        item: "PT 60 16PK",
        clientId: "56184312740",
        split: false,
        priceCents: 160000,
        totalCents: 16000,
      },
      {
        staffName: "Kristen Arias",
        date: "2026-10-31",
        item: "Monthly Membership - Adult",
        clientId: "100018371",
        split: true,
        priceCents: 26900,
        totalCents: 2690,
      },
    ]);
  });

  it("reads the HTML/Excel export", () => {
    const html = `<table><tr><td colspan="16">Daniel Griffin</td></tr>
      <tr><th>Date</th><th>Item Name</th></tr>
      <tr><td>10/30/2026</td><td>PT 60 Single Session (add-on)</td><td>100017663</td><td>Commission</td><td>&#36;4,400.00</td><td>C&amp;D</td><td>[Logs]</td>
      <td>$440.00</td><td>$0.00</td><td>$0.00</td><td>$0.00</td><td>$0.00</td><td>$0.00</td><td>$0.00</td><td>$0.00</td><td>$440.00</td></tr></table>`;
    const [line] = parseCommissionReport(html);
    expect(line).toMatchObject({ staffName: "Daniel Griffin", date: "2026-10-30", priceCents: 440000, totalCents: 44000, split: false });
  });

  it("keeps returns as negative lines", () => {
    const text = [
      "Erinn Cox",
      "11/1/2026\tPT 60- 4PK\t100018371\tCommission\t($500.00)\tD Client\t[Logs]\t($50.00)\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\t($50.00)",
    ].join("\n");
    expect(parseCommissionReport(text)[0]).toMatchObject({ priceCents: -50000, totalCents: -5000 });
  });
});
