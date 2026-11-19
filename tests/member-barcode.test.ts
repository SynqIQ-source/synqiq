import { describe, expect, it } from "vitest";
import { CODE128_PATTERNS, code128Values, code128Widths } from "@/lib/member/barcode";

describe("member ID barcode (Code 128B)", () => {
  it("has a well-formed pattern table", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    for (const pattern of CODE128_PATTERNS.slice(0, 106)) expect([...pattern].reduce((sum, d) => sum + Number(d), 0)).toBe(11);
    expect([...CODE128_PATTERNS[106]].reduce((sum, d) => sum + Number(d), 0)).toBe(13);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });

  it("encodes start B, the characters, the checksum and stop", () => {
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 mod 103 = 55.
    expect(code128Values("PJJ123C")).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
    expect(code128Widths("1").length).toBe(6 * 3 + 7);
  });
});
