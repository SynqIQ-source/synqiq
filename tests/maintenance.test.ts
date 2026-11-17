import { describe, expect, it } from "vitest";
import { checkMediaUpload, costSummary, findMaintenanceAlias, parseDollars, vendorEmailText } from "@/lib/maintenance/rules";
import { equipmentValues, vendorValues } from "@/lib/maintenance/catalog";

const MB = 1024 * 1024;

describe("maintenance media limits", () => {
  it("accepts photos up to 8", () => {
    const seven = Array.from({ length: 7 }, () => ({ kind: "photo" as const, duration_seconds: null }));
    expect(checkMediaUpload(seven, { contentType: "image/jpeg", sizeBytes: 3 * MB, durationSeconds: null })).toEqual({
      ok: true,
      kind: "photo",
    });
    const eight = [...seven, { kind: "photo" as const, duration_seconds: null }];
    expect(checkMediaUpload(eight, { contentType: "image/heic", sizeBytes: 3 * MB, durationSeconds: null }).ok).toBe(false);
  });

  it("allows two videos totalling 30 seconds", () => {
    const first = checkMediaUpload([], { contentType: "video/quicktime", sizeBytes: 20 * MB, durationSeconds: 18 });
    expect(first).toEqual({ ok: true, kind: "video" });
    const one = [{ kind: "video" as const, duration_seconds: 18 }];
    expect(checkMediaUpload(one, { contentType: "video/mp4", sizeBytes: 10 * MB, durationSeconds: 12 }).ok).toBe(true);
    const tooLong = checkMediaUpload(one, { contentType: "video/mp4", sizeBytes: 10 * MB, durationSeconds: 15 });
    expect(tooLong.ok).toBe(false);
    const two = [...one, { kind: "video" as const, duration_seconds: 5 }];
    expect(checkMediaUpload(two, { contentType: "video/mp4", sizeBytes: 1 * MB, durationSeconds: 2 }).ok).toBe(false);
  });

  it("rejects oversize files, unknown length and other types", () => {
    expect(checkMediaUpload([], { contentType: "video/mp4", sizeBytes: 60 * MB, durationSeconds: 10 }).ok).toBe(false);
    expect(checkMediaUpload([], { contentType: "video/mp4", sizeBytes: 5 * MB, durationSeconds: null }).ok).toBe(false);
    expect(checkMediaUpload([], { contentType: "application/pdf", sizeBytes: 1 * MB, durationSeconds: null }).ok).toBe(false);
  });
});

describe("maintenance money", () => {
  it("parses dollars", () => {
    expect(parseDollars("1,250.50")).toBe(125050);
    expect(parseDollars("$450")).toBe(45000);
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
  });

  it("totals quotes and payments separately", () => {
    expect(
      costSummary([
        { kind: "quote", amount_cents: 50000 },
        { kind: "paid", amount_cents: 45000 },
        { kind: "paid", amount_cents: 12000 },
        { kind: "note", amount_cents: null },
      ]),
    ).toEqual({ quotedCents: 50000, paidCents: 57000 });
  });
});

describe("vendor email", () => {
  it("includes the report, model/serial, troubleshooting and media links", () => {
    const text = vendorEmailText({
      studioName: "The Preserve Houston",
      vendorContact: "Sam",
      equipment: { name: "Steam generator", area: "Men's locker room", model: "SG-12", serial: "A123" },
      locationText: null,
      title: "Steam room not heating",
      description: "No steam since this morning.",
      reportedAt: "Nov 16, 2026 6:10 AM",
      troubleshooting: ["Reset the breaker", "Checked the water valve: open"],
      mediaLinks: [{ kind: "video", url: "https://example.com/v" }],
      message: "Hi Sam, can you come out tomorrow?",
    });
    expect(text.startsWith("Hi Sam, can you come out tomorrow?")).toBe(true);
    for (const part of [
      "Model #: SG-12",
      "Serial #: A123",
      "Steam room not heating",
      "- Reset the breaker",
      "Video 1: https://example.com/v",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("finds the issue's reply address among the recipients", () => {
    expect(findMaintenanceAlias(['"Maint" <m-abc123@relay.synqiq.co>'], "relay.synqiq.co")).toBe("m-abc123@relay.synqiq.co");
    expect(findMaintenanceAlias(["g-abc@relay.synqiq.co"], "relay.synqiq.co")).toBeNull();
    expect(findMaintenanceAlias(["m-abc@other.com"], "relay.synqiq.co")).toBeNull();
  });
});

describe("equipment and vendor forms", () => {
  it("needs a name; vendor needs an email or phone", () => {
    expect(equipmentValues({ name: " " }).ok).toBe(false);
    expect(equipmentValues({ name: "Treadmill 4", isCritical: true }).ok).toBe(true);
    expect(vendorValues({ name: "Acme HVAC" }).ok).toBe(false);
    expect(vendorValues({ name: "Acme HVAC", email: "nope" }).ok).toBe(false);
    const ok = vendorValues({ name: "Acme HVAC", phone: "(713) 555-0100" });
    expect(ok.ok && ok.values.phone).toBe("+17135550100");
  });
});
