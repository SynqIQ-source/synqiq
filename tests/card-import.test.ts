import { describe, expect, it } from "vitest";
import { parseCsv, readCardImport } from "@/lib/billing/card-import";

describe("card file from the Mindbody export", () => {
  it("reads quoted CSV", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\n\n1,2')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["1", "2"],
    ]);
  });

  it("finds the columns by name and checks each row", () => {
    const result = readCardImport(
      "﻿Client ID,Customer,Payment_Method\n100011363,cus_ABC123,pm_XYZ\nabc,cus_1,pm_1\n100000002,acct_1,pm_2\n100000003,cus_2,tok_3\n",
    );
    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toEqual([{ line: 2, clientId: "100011363", customerId: "cus_ABC123", paymentMethodId: "pm_XYZ" }]);
    expect(result.problems).toHaveLength(3);
  });

  it("says which columns are missing", () => {
    expect(readCardImport("name,pm\nSam,pm_1").missingColumns).toEqual(["clientId", "customerId"]);
    expect(readCardImport("").problems).toEqual(["The file is empty."]);
  });
});
