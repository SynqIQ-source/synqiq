import { cache } from "react";
import { getEnabledModules } from "@/lib/modules";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentStaff, type CurrentStaff } from "@/lib/current-staff";
import { canUseCrm, managesSales } from "@/lib/permissions";

export { canUseCrm };

// The CRM is a separately sold module (org_modules.module = 'crm'). Every CRM
// page, API route and nav item checks this; an org without it gets a 404, as
// if the routes didn't exist.
export const isCrmEnabled = cache(async function isCrmEnabled(organizationId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("org_modules")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("module", "crm")
    .maybeSingle();
  return data?.status === "enabled";
});

// For CRM dashboard pages: signed-in club admin, sales lead or salesperson in
// an org with the module, else 404. Pages limit Sales to their own guests
// and numbers (lib/permissions.ts seesOnlyOwnSales).
export async function requireCrmStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff || !canUseCrm(staff) || !(await isCrmEnabled(staff.organizationId))) {
    notFound();
  }
  return staff;
}

// Same check for API routes; returns null instead of throwing a 404 page.
// adminOnly: club admins only. managers: club admins and sales leads.
export async function getCrmStaffForApi(
  options: { adminOnly?: boolean; managers?: boolean } = {},
): Promise<CurrentStaff | null> {
  const staff = await getCurrentStaff();
  if (
    !staff ||
    !canUseCrm(staff) ||
    (options.adminOnly && staff.role !== "admin") ||
    (options.managers && !managesSales(staff))
  ) {
    return null;
  }
  return (await isCrmEnabled(staff.organizationId)) ? staff : null;
}

// Whether CRM staff may work this one contact: club admins and sales leads
// any of them; Sales only guests assigned to them (or merged into one that is).
export async function canWorkContact(staff: CurrentStaff, contactId: string): Promise<boolean> {
  if (managesSales(staff)) return true;
  if (!canUseCrm(staff)) return false;
  return isAssignedTo(staff, contactId, "assigned_staff_id");
}

// Who may open one guest/member profile: club admins and sales leads (any
// guest), Sales (guests assigned to them), or the trainer assigned to that
// member -- who gets the same page with fewer actions (message, call, note;
// no edit, assign, sell, merge or delete). `full` says which.
export type ContactViewer = { staff: CurrentStaff; full: boolean };

async function isAssignedTo(
  staff: CurrentStaff,
  contactId: string,
  column: "trainer_staff_id" | "assigned_staff_id",
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("crm_contacts")
    .select(`id, ${column}, merged_into_id`)
    .eq("id", contactId)
    .eq("organization_id", staff.organizationId)
    .maybeSingle<{ id: string; merged_into_id: string | null } & Record<typeof column, string | null>>();
  if (!data) return false;
  if (data[column] === staff.id) return true;
  if (!data.merged_into_id) return false;
  const { data: parent } = await admin
    .from("crm_contacts")
    .select(column)
    .eq("id", data.merged_into_id)
    .maybeSingle<Record<typeof column, string | null>>();
  return parent?.[column] === staff.id;
}

const isAssignedTrainer = (staff: CurrentStaff, contactId: string) => isAssignedTo(staff, contactId, "trainer_staff_id");

// For a profile page: CRM staff, or the member's assigned trainer, in an
// org with the module; else 404.
// Member profiles exist with the CRM (guests) or the Trainer module (new
// members and their trainers' follow-up), so either one opens them.
async function hasContactModule(organizationId: string): Promise<boolean> {
  const modules = await getEnabledModules(organizationId);
  return modules.has("crm") || modules.has("trainer");
}

export async function requireContactViewer(contactId: string): Promise<ContactViewer> {
  const staff = await getCurrentStaff();
  if (!staff || !(await hasContactModule(staff.organizationId))) notFound();
  if (await canWorkContact(staff, contactId)) return { staff, full: true };
  if (await isAssignedTrainer(staff, contactId)) return { staff, full: false };
  notFound();
}

// Same check for API routes on one contact; null when not allowed.
export async function getContactViewerForApi(contactId: string): Promise<ContactViewer | null> {
  const staff = await getCurrentStaff();
  if (!staff || !(await hasContactModule(staff.organizationId))) return null;
  if (await canWorkContact(staff, contactId)) return { staff, full: true };
  return (await isAssignedTrainer(staff, contactId)) ? { staff, full: false } : null;
}

// For trainer-facing CRM pages (Follow Up → New members): any signed-in
// staff member in an org with the module.
export async function requireCrmModuleStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff || !(await isCrmEnabled(staff.organizationId))) notFound();
  return staff;
}
