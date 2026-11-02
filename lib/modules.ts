import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/current-staff";
import type { ModuleKey } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Which modules a studio has turned on (org_modules, status "enabled").
export const getEnabledModules = cache(async function getEnabledModules(organizationId: string): Promise<Set<ModuleKey>> {
  const { data } = await createSupabaseAdminClient()
    .from("org_modules")
    .select("module")
    .eq("organization_id", organizationId)
    .eq("status", "enabled");
  return new Set((data ?? []).map((row) => row.module as ModuleKey));
});

// Pages that belong to a module: signed-in staff of a studio with any of
// these modules on, else a 404 (the page isn't part of their plan).
export async function requireModule(...modules: ModuleKey[]): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  const enabled = await getEnabledModules(staff.organizationId);
  if (!modules.some((module) => enabled.has(module))) notFound();
  return staff;
}
