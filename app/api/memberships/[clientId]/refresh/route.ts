import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { syncMemberProfile } from "@/lib/sync/member-profile";

type RouteParams = { params: Promise<{ clientId: string }> };

export const maxDuration = 120;

// Club Admins pull one member's visits, bookings, purchases and services
// from Mindbody (read-only GETs) onto their page.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { clientId: raw } = await params;
  const clientId = decodeURIComponent(raw);
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  if (!/^[\w-]{1,40}$/.test(clientId)) return NextResponse.json({ success: false, error: "Unknown member." }, { status: 404 });

  // The member must be one of this studio's clients.
  const supabase = await getScopedClient(currentStaff);
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("organization_id", currentStaff.organizationId)
    .eq("mindbody_client_id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ success: false, error: "Unknown member." }, { status: 404 });

  const result = await syncMemberProfile({ organizationId: currentStaff.organizationId, mindbodyClientId: clientId });
  if (!result.success) {
    console.error("[member-profile] refresh failed:", result.error);
    return NextResponse.json({ success: false, error: "Couldn't reach Mindbody. Try again in a minute." }, { status: 502 });
  }
  return NextResponse.json(result);
}
