import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CrmOrg = { id: string; name: string; timezone: string };

// Name + time zone for the org a kiosk device or staff member belongs to.
// Ages are calculated in this time zone (requirement 5c).
export const getCrmOrg = cache(async function getCrmOrg(organizationId: string): Promise<CrmOrg> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, timezone")
    .eq("id", organizationId)
    .single();
  if (error || !data) throw error ?? new Error("organization not found");
  return { id: data.id, name: data.name, timezone: data.timezone ?? "America/Chicago" };
});
