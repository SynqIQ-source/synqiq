import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Club Admins choose which members can test online booking during the
// parallel run (add / remove). Removing someone also signs them out.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { mindbodyClientId?: unknown; remove?: unknown } | null;
  const clientId = typeof body?.mindbodyClientId === "string" ? body.mindbodyClientId : "";
  if (!/^[\w-]{1,40}$/.test(clientId)) return NextResponse.json({ success: false, error: "Pick a member." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const orgId = currentStaff.organizationId;

  if (body?.remove === true) {
    await admin.from("member_portal_testers").delete().eq("organization_id", orgId).eq("mindbody_client_id", clientId);
    const { data: account } = await admin
      .from("member_accounts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .maybeSingle();
    if (account) await admin.from("member_sessions").delete().eq("account_id", account.id);
    return NextResponse.json({ success: true });
  }

  const { data: client } = await admin
    .from("clients")
    .select("first_name, last_name, email")
    .eq("organization_id", orgId)
    .eq("mindbody_client_id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ success: false, error: "Member not found." }, { status: 404 });
  if (!client.email) return NextResponse.json({ success: false, error: "This member has no email on file." }, { status: 400 });
  const { error } = await admin.from("member_portal_testers").upsert(
    {
      organization_id: orgId,
      mindbody_client_id: clientId,
      client_name: `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim(),
      added_by_staff_id: currentStaff.id,
    },
    { onConflict: "organization_id,mindbody_client_id" },
  );
  if (error) {
    console.error("[member-portal] add tester failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
