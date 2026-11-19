import { describe, expect, it } from "vitest";
import { canViewMembers, isClubAdmin } from "@/lib/permissions";

const who = (role: "admin" | "sales_lead" | "sales" | "staff") => ({ role, canSell: false, isInstructor: false, isTrainer: false });

describe("Members access", () => {
  it("is open to Club Admins, Sales Leads and Sales", () => {
    expect(canViewMembers(who("admin"))).toBe(true);
    expect(canViewMembers(who("sales_lead"))).toBe(true);
    expect(canViewMembers(who("sales"))).toBe(true);
    expect(canViewMembers(who("staff"))).toBe(false);
  });

  it("keeps billing edits to Club Admins", () => {
    expect(isClubAdmin(who("sales"))).toBe(false);
    expect(isClubAdmin(who("admin"))).toBe(true);
  });
});
