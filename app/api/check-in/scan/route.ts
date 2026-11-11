import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCheckInStatus } from "@/lib/checkin/status";
import { normalizeCardCode } from "@/lib/checkin/card";

// A key card was scanned at the front desk: find the person by the card's
// number (their Mindbody client ID, else Mindbody's internal ID) and return
// what covers the visit. The page then checks them in or flags them.
export async function GET(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  const code = normalizeCardCode(request.nextUrl.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ success: false, error: "That card didn't read. Scan again." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const orgId = currentStaff.organizationId;
  let { data: client } = await admin
    .from("clients")
    .select("mindbody_client_id")
    .eq("organization_id", orgId)
    .eq("mindbody_client_id", code)
    .maybeSingle();
  if (!client && /^\d{1,10}$/.test(code)) {
    ({ data: client } = await admin
      .from("clients")
      .select("mindbody_client_id")
      .eq("organization_id", orgId)
      .eq("mindbody_unique_id", Number(code))
      .maybeSingle());
  }
  if (!client?.mindbody_client_id) {
    return NextResponse.json({ success: false, error: `No one has card ${code}. Look them up by name.` }, { status: 404 });
  }
  const status = await loadCheckInStatus(orgId, client.mindbody_client_id as string);
  if (!status) return NextResponse.json({ success: false, error: "Unknown person." }, { status: 404 });
  return NextResponse.json({ success: true, status });
}
