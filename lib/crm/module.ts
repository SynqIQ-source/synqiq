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
