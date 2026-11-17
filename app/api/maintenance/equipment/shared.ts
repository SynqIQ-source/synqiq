import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

// The owner and default vendor must belong to this studio.
export async function checkOwnerAndVendor(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  values: { owner_staff_id: string | null; default_vendor_id: string | null },
): Promise<string | null> {
  if (values.owner_staff_id) {
    const { data } = await admin
      .from("staff")
      .select("id")
      .eq("id", values.owner_staff_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!data) return "Pick an owner from your staff.";
  }
  if (values.default_vendor_id) {
    const { data } = await admin
      .from("maintenance_vendors")
      .select("id")
      .eq("id", values.default_vendor_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!data) return "Pick one of your vendors.";
  }
  return null;
}
