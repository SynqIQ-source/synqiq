import { describe, expect, it } from "vitest";
import { mergePersonal, toPersonal, validatePersonalEdit } from "@/lib/memberships/personal";

const TODAY = "2026-11-10";
const mindbody = toPersonal({
  Id: "561",
  FirstName: "Pat",
  LastName: "Lee",
  Email: "pat@example.com",
  MobilePhone: "7135550100",
  BirthDate: "1989-04-29T00:00:00",
  City: "Houston",
});

describe("personal information", () => {
  it("reads Mindbody's record, dropping its empty birthday", () => {
    expect(mindbody).toMatchObject({ firstName: "Pat", email: "pat@example.com", birthDate: "1989-04-29", homePhone: null });
    expect(toPersonal({ BirthDate: "0001-01-01T00:00:00" }).birthDate).toBeNull();
  });

  it("SynqIQ edits win over Mindbody, including clearing a field", () => {
    const merged = mergePersonal(mindbody, { email: "pat.lee@example.com", city: null });
    expect(merged).toMatchObject({ email: "pat.lee@example.com", city: null, mobilePhone: "7135550100" });
    expect(merged.edited.sort()).toEqual(["city", "email"]);
  });

  it("returns only real changes, and checks each field", () => {
    const current = mergePersonal(mindbody, {});
    expect(validatePersonalEdit({ email: " pat@example.com ", mobilePhone: "713-555-0199" }, current, TODAY)).toEqual({
      ok: true,
      changes: { mobilePhone: { from: "7135550100", to: "713-555-0199" } },
    });
    expect(validatePersonalEdit({ homePhone: "" }, current, TODAY)).toEqual({ ok: true, changes: {} });
    expect(validatePersonalEdit({ email: "nope" }, current, TODAY)).toMatchObject({ ok: false });
    expect(validatePersonalEdit({ firstName: "  " }, current, TODAY)).toMatchObject({ ok: false });
    expect(validatePersonalEdit({ birthDate: "2027-01-01" }, current, TODAY)).toMatchObject({ ok: false });
    expect(validatePersonalEdit({ mobilePhone: "12" }, current, TODAY)).toMatchObject({ ok: false });
    expect(validatePersonalEdit({ email: 5 }, current, TODAY)).toMatchObject({ ok: false });
  });
});
