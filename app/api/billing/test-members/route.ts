import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, requireClubAdminApi } from "@/lib/payroll/api";
import { runPracticeBilling } from "@/lib/billing/practice-job";

// Club Admin: add or remove a member from the billing test. Adding imports
// their Mindbody autopay contracts into SynqIQ schedules and records the
// practice charges so far (nothing is charged). Removing drops their
// imported schedules and practice charges.
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as { mindbodyClientId?: unknown; remove?: unknown } | null;
  const clientId = typeof body?.mindbodyClientId === "string" ? body.mindbodyClientId : "";
  if (!/^[\w-]{1,40}$/.test(clientId)) return fail("Pick a member.");
  const org = auth.currentStaff.organizationId;
  const admin = createSupabaseAdminClient();

  if (body?.remove === true) {
    await admin.from("billing_test_members").delete().eq("organization_id", org).eq("mindbody_client_id", clientId);
    await admin
      .from("member_billing_schedules")
      .delete()
      .eq("organization_id", org)
      .eq("mindbody_client_id", clientId)
      .eq("source", "mindbody");
    return NextResponse.json({ success: true });
  }

  const { data: client } = await admin
    .from("clients")
    .select("id")
    .eq("organization_id", org)
    .eq("mindbody_client_id", clientId)
    .maybeSingle();
  if (!client) return fail("Member not found.", 404);
  const { error } = await admin
    .from("billing_test_members")
    .upsert(
      { organization_id: org, mindbody_client_id: clientId, added_by_staff_id: auth.currentStaff.id },
      { onConflict: "organization_id,mindbody_client_id" },
    );
  if (error) return fail("Couldn't save. Try again.", 500);
  try {
    const result = await runPracticeBilling(org, { clientIds: [clientId] });
    return NextResponse.json({ success: true, ...result });
  } catch (runError) {
    console.error("[billing/test-members] run failed:", runError);
    return fail("Added, but the first check didn't finish. It runs again tonight.", 500);
  }
}
