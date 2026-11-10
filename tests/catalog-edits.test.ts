import { describe, expect, it } from "vitest";
import { applyCatalogEdit, effective } from "@/lib/classes/catalog-edits";

const schedule = {
  id: "s1",
  days: [1, 3],
  start_time: "06:05:00",
  end_time: "06:50:00",
  capacity: 12,
  mindbody_resource_id: 1,
  staff_mindbody_id: 5,
  edits: {},
};

describe("class catalog edits", () => {
  it("edits win over Mindbody's copy, with defaults for SynqIQ-only fields", () => {
    const merged = effective("class_schedule", { ...schedule, edits: { capacity: 14 } });
    expect(merged).toMatchObject({ capacity: 14, active: true, start_time: "06:05:00" });
    expect(merged.edited).toEqual(["capacity"]);
    expect(effective("program", { id: "p", name: "PT", edits: { included_in_membership: false } }).edited).toEqual([]);
    expect(effective("program", { id: "p", name: "Yoga", edits: null })).toMatchObject({
      included_in_membership: true,
      late_cancel_fee_cents: 0,
    });
  });

  it("saves only real changes and logs from -> to", () => {
    const result = applyCatalogEdit("class_schedule", schedule, { set: { capacity: "14", start_time: "06:05", days: [3, 1, 1] } });
    expect(result).toEqual({ ok: true, edits: { capacity: 14 }, changes: { capacity: { from: 12, to: 14 } } });
  });

  it("resets a field back to Mindbody's value", () => {
    const result = applyCatalogEdit("class_schedule", { ...schedule, edits: { capacity: 14 } }, { reset: ["capacity"] });
    expect(result).toEqual({ ok: true, edits: {}, changes: { capacity: { from: 14, to: "(Mindbody)" } } });
  });

  it("checks values", () => {
    expect(applyCatalogEdit("class_schedule", schedule, { set: { end_time: "06:00" } })).toMatchObject({ ok: false });
    expect(applyCatalogEdit("class_schedule", schedule, { set: { days: [] } })).toMatchObject({ ok: false });
    expect(applyCatalogEdit("class_schedule", schedule, { set: { capacity: 0 } })).toMatchObject({ ok: false });
    expect(applyCatalogEdit("class_schedule", schedule, { set: { start_time: "25:00" } })).toMatchObject({ ok: false });
    expect(applyCatalogEdit("class_schedule", schedule, { set: { price: 5 } })).toMatchObject({ ok: false, error: "Unknown field." });
    expect(applyCatalogEdit("class_type", { id: "t", name: "Svelte", edits: {} }, { set: { name: "  " } })).toMatchObject({ ok: false });
    expect(
      applyCatalogEdit(
        "program",
        { id: "p", name: "Pool", edits: {} },
        { set: { late_cancel_fee_cents: 2000, included_in_membership: false } },
      ),
    ).toMatchObject({
      ok: true,
      edits: { late_cancel_fee_cents: 2000, included_in_membership: false },
    });
  });
});
