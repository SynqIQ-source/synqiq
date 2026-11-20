import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Club Admins add a class category in SynqIQ (e.g. a workshop series with its
// own pack). Classes link to categories by program id, so a SynqIQ category
// gets a negative one -- Mindbody's are always positive and its import only
// touches its own.
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; itemId?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ success: false, error: "Name the category." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;

  const [{ data: existing }, { data: lowest }] = await Promise.all([
    admin
      .from("departments")
      .select("id")
      .eq("organization_id", org)
      .ilike("name", name.replace(/[%_\\]/g, "\\$&"))
      .maybeSingle(),
    admin.from("departments").select("mindbody_program_id").eq("organization_id", org).order("mindbody_program_id").limit(1).maybeSingle(),
  ]);
  if (existing) return NextResponse.json({ success: false, error: "You already have a category with that name." }, { status: 400 });

  let itemId: string | null = null;
  if (typeof body?.itemId === "string" && UUID.test(body.itemId)) {
    const { data: item } = await admin.from("included_items").select("id").eq("organization_id", org).eq("id", body.itemId).maybeSingle();
    itemId = (item?.id as string | undefined) ?? null;
  }
  const programId = Math.min(Number(lowest?.mindbody_program_id ?? 0), 0) - 1;
  const { data: created, error } = await admin
    .from("departments")
    .insert({
      organization_id: org,
      name,
      mindbody_program_id: programId,
      schedule_type: "Class",
      active: true,
      required_item_id: itemId,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  await admin.from("catalog_edits").insert({
    organization_id: org,
    entity: "program",
    row_id: created.id,
    changes: { name: { from: null, to: name } },
    edited_by_staff_id: staff.id,
    note: "Created in SynqIQ",
  });
  return NextResponse.json({ success: true, id: created.id });
}
