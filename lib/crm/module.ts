import { cache } from "react";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentStaff, type CurrentStaff } from "@/lib/current-staff";

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

export function canUseCrm(staff: CurrentStaff): boolean {
  return staff.role === "admin" || staff.canSell;
}

// For CRM dashboard pages: signed-in admin or sales staff in an org with the
// module, else 404.
export async function requireCrmStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff || !canUseCrm(staff) || !(await isCrmEnabled(staff.organizationId))) {
    notFound();
  }
  return staff;
}

// Same check for API routes; returns null instead of throwing a 404 page.
export async function getCrmStaffForApi(options: { adminOnly?: boolean } = {}): Promise<CurrentStaff | null> {
  const staff = await getCurrentStaff();
  if (!staff || !canUseCrm(staff) || (options.adminOnly && staff.role !== "admin")) {
    return null;
  }
  return (await isCrmEnabled(staff.organizationId)) ? staff : null;
}

// Who may open one guest/member profile: full CRM staff (admins and
// sellers), or the trainer assigned to that member -- who gets the same
// page with fewer actions (message, call, note; no edit, assign, sell,
// merge or delete). `full` says which.
export type ContactViewer = { staff: CurrentStaff; full: boolean };

async function isAssignedTrainer(staff: CurrentStaff, contactId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("crm_contacts")
    .select("id, trainer_staff_id, merged_into_id")
    .eq("id", contactId)
    .eq("organization_id", staff.organizationId)
    .maybeSingle();
  if (!data) return false;
  if (data.trainer_staff_id === staff.id) return true;
  if (!data.merged_into_id) return false;
  const { data: parent } = await admin
    .from("crm_contacts")
    .select("trainer_staff_id")
    .eq("id", data.merged_into_id)
    .maybeSingle();
  return parent?.trainer_staff_id === staff.id;
}

// For a profile page: CRM staff, or the member's assigned trainer, in an
// org with the module; else 404.
export async function requireContactViewer(contactId: string): Promise<ContactViewer> {
  const staff = await getCurrentStaff();
  if (!staff || !(await isCrmEnabled(staff.organizationId))) notFound();
  if (canUseCrm(staff)) return { staff, full: true };
  if (await isAssignedTrainer(staff, contactId)) return { staff, full: false };
  notFound();
}

// Same check for API routes on one contact; null when not allowed.
export async function getContactViewerForApi(contactId: string): Promise<ContactViewer | null> {
  const staff = await getCurrentStaff();
  if (!staff || !(await isCrmEnabled(staff.organizationId))) return null;
  if (canUseCrm(staff)) return { staff, full: true };
  return (await isAssignedTrainer(staff, contactId)) ? { staff, full: false } : null;
}

// For trainer-facing CRM pages (Follow Up → New members): any signed-in
// staff member in an org with the module.
export async function requireCrmModuleStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff || !(await isCrmEnabled(staff.organizationId))) notFound();
  return staff;
}
