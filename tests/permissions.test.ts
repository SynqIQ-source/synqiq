import { describe, expect, it } from "vitest";
import {
  canSeeVolunteerEmails,
  canUseCrm,
  canViewOverview,
  canViewPay,
  homePath,
  isClubAdmin,
  isInstructorAccess,
  isStaffRole,
  isTrainerAccess,
  managesSales,
  seesOnlyOwnSales,
  type StaffRole,
} from "@/lib/permissions";

const who = (role: StaffRole, tags: Partial<{ canSell: boolean; isInstructor: boolean; isTrainer: boolean }> = {}) => ({
  role,
  canSell: tags.canSell ?? role === "sales",
  isInstructor: tags.isInstructor ?? false,
  isTrainer: tags.isTrainer ?? false,
});

describe("role matrix (lib/permissions.ts)", () => {
  it("Club Admin can do everything in the studio", () => {
    const admin = who("admin");
    expect(isClubAdmin(admin)).toBe(true);
    expect(managesSales(admin)).toBe(true);
    expect(canUseCrm(admin)).toBe(true);
    expect(seesOnlyOwnSales(admin)).toBe(false);
    expect(isInstructorAccess(admin)).toBe(true);
    expect(isTrainerAccess(admin)).toBe(true);
    expect(canViewOverview(admin)).toBe(true);
    expect(canViewPay(admin)).toBe(true);
  });

  it("Sales Lead manages all sales but not the studio", () => {
    const lead = who("sales_lead");
    expect(isClubAdmin(lead)).toBe(false);
    expect(managesSales(lead)).toBe(true);
    expect(canUseCrm(lead)).toBe(true);
    expect(seesOnlyOwnSales(lead)).toBe(false);
    expect(canViewPay(lead)).toBe(false);
    expect(canViewOverview(lead)).toBe(false);
  });

  it("Sales only see their own guests and numbers", () => {
    const sales = who("sales");
    expect(canUseCrm(sales)).toBe(true);
    expect(managesSales(sales)).toBe(false);
    expect(seesOnlyOwnSales(sales)).toBe(true);
    expect(isClubAdmin(sales)).toBe(false);
  });

  it("Staff with no tags get no management, sales, teaching or training pages", () => {
    const staff = who("staff");
    expect(canUseCrm(staff)).toBe(false);
    expect(isInstructorAccess(staff)).toBe(false);
    expect(isTrainerAccess(staff)).toBe(false);
    expect(canViewOverview(staff)).toBe(false);
    expect(homePath(staff)).toBe("/dashboard/messages");
  });

  it("Instructor tag opens Overview (without pay) and the Teaching pages", () => {
    const instructor = who("staff", { isInstructor: true });
    expect(canViewOverview(instructor)).toBe(true);
    expect(canViewPay(instructor)).toBe(false);
    expect(isInstructorAccess(instructor)).toBe(true);
    expect(isTrainerAccess(instructor)).toBe(false);
    expect(homePath(instructor)).toBe("/dashboard");
  });

  it("Trainer tag opens trainer pages and lands on New Members", () => {
    const trainer = who("staff", { isTrainer: true });
    expect(isTrainerAccess(trainer)).toBe(true);
    expect(canViewOverview(trainer)).toBe(false);
    expect(homePath(trainer)).toBe("/dashboard/sales/new-members");
  });

  it("tags combine with each other and with roles", () => {
    const both = who("sales", { isInstructor: true, isTrainer: true });
    expect(seesOnlyOwnSales(both)).toBe(true);
    expect(isInstructorAccess(both)).toBe(true);
    expect(isTrainerAccess(both)).toBe(true);
    expect(canViewPay(both)).toBe(false);
  });

  it("only the four roles are valid", () => {
    expect(["admin", "sales_lead", "sales", "staff"].every(isStaffRole)).toBe(true);
    expect(isStaffRole("instructor")).toBe(false);
    expect(isStaffRole("owner")).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

describe("sub-request volunteer emails", () => {
  const requester = "staff-requester";
  it("are visible to Club Admins and the requesting instructor only", () => {
    expect(canSeeVolunteerEmails({ ...who("admin"), id: "someone" }, requester)).toBe(true);
    expect(canSeeVolunteerEmails({ ...who("staff", { isInstructor: true }), id: requester }, requester)).toBe(true);
    expect(canSeeVolunteerEmails({ ...who("staff", { isInstructor: true }), id: "other" }, requester)).toBe(false);
    expect(canSeeVolunteerEmails({ ...who("sales_lead"), id: "other" }, requester)).toBe(false);
  });
});
