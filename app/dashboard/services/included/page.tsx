import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadIncludedSetup } from "@/lib/coverage/included";
import { IncludedEditor, type PricingOptionRow } from "./included-editor";

export const metadata: Metadata = { title: "What's included" };
export const dynamic = "force-dynamic";

// Services & Pricing > What's included (Club Admins): what memberships and
// passes include, and what each class category needs to be booked.
export default async function IncludedPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const [setup, { data: items }, { data: categories }, { data: services }, { data: posItems }] = await Promise.all([
    loadIncludedSetup(admin, org),
    admin.from("included_items").select("id, name, active, sort").eq("organization_id", org).order("sort").order("name"),
    admin.from("departments").select("id, name, schedule_type, required_item_id, active").eq("organization_id", org).order("name"),
    admin
      .from("member_services")
      .select("product_id, name, program, count")
      .eq("organization_id", org)
      .eq("is_current", true)
      .not("product_id", "is", null),
    admin
      .from("pos_items")
      .select("id, name, kind, sessions")
      .eq("organization_id", org)
      .eq("active", true)
      .is("deleted_at", null)
      .in("kind", ["membership", "service"])
      .order("name"),
  ]);

  // Pricing options members hold today (from Mindbody), with how many hold each.
  const byProduct = new Map<string, PricingOptionRow>();
  for (const row of services ?? []) {
    const key = String(row.product_id);
    const current = byProduct.get(key);
    if (current) current.holders += 1;
    else
      byProduct.set(key, {
        key: `mb:${key}`,
        productId: key,
        posItemId: null,
        name: row.name as string,
        group: (row.program as string | null) ?? "Other",
        holders: 1,
        ticked: setup.grants[key] ?? [],
      });
  }
  const synqiq: PricingOptionRow[] = (posItems ?? []).map((row) => ({
    key: `pos:${row.id}`,
    productId: null,
    posItemId: row.id as string,
    name: row.name as string,
    group: row.kind === "membership" ? "Sold in SynqIQ: memberships" : "Sold in SynqIQ: packs & services",
    holders: 0,
    ticked: setup.posGrants[row.id as string] ?? [],
  }));

  return (
    <DashboardShell
      title="What's included"
      description="What each membership and pass includes, and what each class category needs. Booking and check-in use this to decide what covers a class."
    >
      <IncludedEditor
        items={(items ?? []).map((row) => ({ id: row.id as string, name: row.name as string, active: Boolean(row.active) }))}
        membershipDefaults={setup.membershipDefaults}
        categories={(categories ?? [])
          .filter((row) => row.active !== false)
          .map((row) => ({
            id: row.id as string,
            name: row.name as string,
            type: (row.schedule_type as string | null) ?? null,
            needs: (row.required_item_id as string | null) ?? null,
          }))}
        options={[...[...byProduct.values()].sort((a, b) => a.group.localeCompare(b.group) || b.holders - a.holders), ...synqiq]}
      />
    </DashboardShell>
  );
}
