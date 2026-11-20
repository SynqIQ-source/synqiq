import { describe, expect, it } from "vitest";
import { iconPath, logoVersion, safeColor, shortStudioName, studioInitials } from "@/lib/member/app-icon";

describe("member app home-screen identity", () => {
  it("uses the studio's initials until a logo is uploaded", () => {
    expect(studioInitials("The Preserve")).toBe("PR");
    expect(studioInitials("The Preserve Houston")).toBe("PH");
    expect(studioInitials("LastSpot Pilates")).toBe("LP");
    expect(studioInitials("")).toBe("S");
  });

  it("keeps the home-screen name short", () => {
    expect(shortStudioName("The Preserve")).toBe("The Preserve");
    expect(shortStudioName("The Preserve Houston")).toBe("Preserve");
    expect(shortStudioName("Demo Studio")).toBe("Demo Studio");
  });

  it("only uses a real color and builds icon paths", () => {
    expect(safeColor("#123abc")).toBe("#123abc");
    expect(safeColor("red")).toBe("#0f766e");
    expect(iconPath(561843, 512, true, "abc")).toBe("/m/561843/app-icon/512?v=abc&maskable=1");
    expect(logoVersion(null)).toBe("0");
    expect(logoVersion("https://x/logo?v=1")).not.toBe(logoVersion("https://x/logo?v=2"));
  });
});
