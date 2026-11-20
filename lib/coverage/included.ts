import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// "What's included" (migration 20261120250000): what a studio's memberships
// and passes include, and what each class category needs.
export type IncludedSetup = {
  membershipDefaults: string[]; // item ids every membership includes unless ticked otherwise
  grants: Record<string, string[]>; // Mindbody product id -> item ids
  posGrants: Record<string, string[]>; // SynqIQ pos item id -> item ids
};

export const EMPTY_SETUP: IncludedSetup = { membershipDefaults: [], grants: {}, posGrants: {} };

export async function loadIncludedSetup(admin: Admin, organizationId: string): Promise<IncludedSetup> {
  const [{ data: org }, { data: grants }] = await Promise.all([
    admin.from("organizations").select("membership_default_items").eq("id", organizationId).maybeSingle(),
    admin.from("included_item_grants").select("item_id, mindbody_product_id, pos_item_id").eq("organization_id", organizationId),
  ]);
  const setup: IncludedSetup = {
    membershipDefaults: ((org?.membership_default_items as string[] | null) ?? []).map(String),
    grants: {},
    posGrants: {},
  };
  for (const row of grants ?? []) {
    const bucket = row.mindbody_product_id ? setup.grants : setup.posGrants;
    const key = String(row.mindbody_product_id ?? row.pos_item_id);
    bucket[key] = [...(bucket[key] ?? []), row.item_id as string];
  }
  return setup;
}
