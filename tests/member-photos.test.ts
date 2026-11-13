import { describe, expect, it } from "vitest";
import { isMindbodyPhotoUrl, photosToCopy } from "@/lib/memberships/photos";

const MB = "https://clients-content.mindbodyonline.com/studios/x/clients/1.jpg";

describe("isMindbodyPhotoUrl", () => {
  it("only accepts Mindbody's https hosts", () => {
    expect(isMindbodyPhotoUrl(MB)).toBe(true);
    expect(isMindbodyPhotoUrl("http://clients-content.mindbodyonline.com/a.jpg")).toBe(false);
    expect(isMindbodyPhotoUrl("https://evil.example/mindbodyonline.com.jpg")).toBe(false);
    expect(isMindbodyPhotoUrl("https://mindbodyonline.com.evil.example/a.jpg")).toBe(false);
    expect(isMindbodyPhotoUrl(null)).toBe(false);
  });
});

describe("photosToCopy", () => {
  it("copies new and changed photos only", () => {
    const rows = [
      { clientId: "new", sourceUrl: MB, copiedFrom: null, path: null },
      { clientId: "same", sourceUrl: MB, copiedFrom: MB, path: "org/same.jpg" },
      { clientId: "changed", sourceUrl: `${MB}?v=2`, copiedFrom: MB, path: "org/changed.jpg" },
      { clientId: "none", sourceUrl: null, copiedFrom: null, path: null },
    ];
    expect(photosToCopy(rows).map((row) => row.clientId)).toEqual(["new", "changed"]);
  });
});
