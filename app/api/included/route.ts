import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Club Admins: "What's included" -- the studio's items, what memberships
// include by default, what each pricing option includes, and what each class
// category needs.
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && UUID.test(id)) : []);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  // Only this studio's items.
  const { data: owned } = await admin.from("included_items").select("id").eq("organization_id", org);
  const mine = new Set((owned ?? []).map((row) => row.id as string));
  const done = (error: { message: string } | null) => (error ? fail(error.message, 500) : NextResponse.json({ success: true }));

  switch (body?.action) {
    case "add_item": {
      if (!name) return fail("Name it.");
      const { error } = await admin.from("included_items").insert({ organization_id: org, name, sort: 10 });
      return error?.code === "23505" ? fail("You already have that.") : done(error);
    }
    case "update_item": {
      const id = typeof body.id === "string" && mine.has(body.id) ? body.id : null;
      if (!id) return fail("Not found.");
      const values: Record<string, unknown> = {};
      if (name) values.name = name;
      if (typeof body.active === "boolean") values.active = body.active;
      const { error } = await admin.from("included_items").update(values).eq("id", id);
      return error?.code === "23505" ? fail("You already have that.") : done(error);
    }
    case "membership_defaults": {
      const { error } = await admin
        .from("organizations")
        .update({ membership_default_items: ids(body.itemIds).filter((id) => mine.has(id)) })
        .eq("id", org);
      return done(error);
    }
    case "grants": {
      // One pricing option: a Mindbody product id or a SynqIQ item id.
      const productId = typeof body.productId === "string" && /^\d{1,20}$/.test(body.productId) ? body.productId : null;
      const posItemId = typeof body.posItemId === "string" && UUID.test(body.posItemId) ? body.posItemId : null;
      if (!productId === !posItemId) return fail("Pick a pricing option.");
      const clear = admin.from("included_item_grants").delete().eq("organization_id", org);
      const { error: clearError } = await (productId ? clear.eq("mindbody_product_id", productId) : clear.eq("pos_item_id", posItemId!));
      if (clearError) return fail(clearError.message, 500);
      const rows = ids(body.itemIds)
        .filter((id) => mine.has(id))
        .map((item_id) => ({ organization_id: org, item_id, mindbody_product_id: productId, pos_item_id: posItemId }));
      if (!rows.length) return NextResponse.json({ success: true });
      const { error } = await admin.from("included_item_grants").insert(rows);
      return done(error);
    }
    case "category_needs": {
      const departmentId = typeof body.departmentId === "string" && UUID.test(body.departmentId) ? body.departmentId : null;
      const itemId = typeof body.itemId === "string" && mine.has(body.itemId) ? body.itemId : null;
      if (!departmentId || !itemId) return fail("Pick what this category needs.");
      const { error } = await admin
        .from("departments")
        .update({ required_item_id: itemId })
        .eq("id", departmentId)
        .eq("organization_id", org);
      return done(error);
    }
    default:
      return fail("Unknown action.");
  }
}
