import { describe, expect, it } from "vitest";
import { runsMaintenance } from "@/lib/permissions";
import { classImageKey, classImagesToCopy } from "@/lib/classes/images";

describe("runsMaintenance", () => {
  it("is Club Admins and Facility Techs", () => {
    expect(runsMaintenance({ role: "admin" })).toBe(true);
    expect(runsMaintenance({ role: "staff", isFacilityTech: true })).toBe(true);
    expect(runsMaintenance({ role: "sales_lead", isFacilityTech: false })).toBe(false);
    expect(runsMaintenance({ role: "staff" })).toBe(false);
  });
});

describe("classImagesToCopy", () => {
  const mb = "https://clients-content.mindbodyonline.com/studios/x/classes/1.jpg";
  const row = (change: Partial<Parameters<typeof classImagesToCopy>[0][number]>) => ({
    id: "1",
    mindbodyImageUrl: mb,
    imageUrl: null,
    imageSource: null,
    copiedFrom: null,
    ...change,
  });

  it("copies a Mindbody photo SynqIQ doesn't have yet", () => {
    expect(classImagesToCopy([row({})])).toHaveLength(1);
  });

  it("copies again when Mindbody's photo changes", () => {
    expect(classImagesToCopy([row({ imageUrl: "https://x/class-images/a.jpg", imageSource: "mindbody", copiedFrom: "old" })])).toHaveLength(
      1,
    );
    expect(classImagesToCopy([row({ imageUrl: "https://x/class-images/a.jpg", imageSource: "mindbody", copiedFrom: mb })])).toHaveLength(0);
  });

  it("never replaces a photo uploaded or removed in SynqIQ", () => {
    expect(classImagesToCopy([row({ imageUrl: "https://x/class-images/mine.jpg", imageSource: "synqiq" })])).toHaveLength(0);
    expect(classImagesToCopy([row({ imageUrl: null, imageSource: "synqiq" })])).toHaveLength(0);
  });

  it("only copies from Mindbody's own hosts", () => {
    expect(classImagesToCopy([row({ mindbodyImageUrl: "https://evil.example.com/a.jpg" })])).toHaveLength(0);
    expect(classImagesToCopy([row({ mindbodyImageUrl: null })])).toHaveLength(0);
  });

  it("finds the storage key of our own URLs only", () => {
    expect(classImageKey("https://p.supabase.co/storage/v1/object/public/class-images/org/a%20b.jpg")).toBe("org/a b.jpg");
    expect(classImageKey(mb)).toBeNull();
  });
});
