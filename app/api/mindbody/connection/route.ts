import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { forgetMindbodyConnectionCache } from "@/lib/mindbody/connection";

// Club Admins: switch this studio's Mindbody connection off (every sync and
// call stops; SynqIQ keeps the data it already has) or back on. Turning it
// off needs the studio's name typed in.
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("name").eq("id", staff.organizationId).maybeSingle();
  const connect = body?.connected === true;
  if (
    !connect &&
    String(body?.confirm ?? "")
      .trim()
      .toLowerCase() !==
      String(org?.name ?? "")
        .trim()
        .toLowerCase()
  )
    return NextResponse.json({ success: false, error: "Type the studio's name to switch Mindbody off." }, { status: 400 });
  const { error } = await admin
    .from("organizations")
    .update(
      connect
        ? { mindbody_disconnected_at: null, mindbody_disconnected_by_staff_id: null }
        : { mindbody_disconnected_at: new Date().toISOString(), mindbody_disconnected_by_staff_id: staff.id },
    )
    .eq("id", staff.organizationId);
  forgetMindbodyConnectionCache();
  return error ? NextResponse.json({ success: false, error: error.message }, { status: 500 }) : NextResponse.json({ success: true });
}
