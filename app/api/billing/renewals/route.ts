import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { renewalsMayCharge, runRenewals } from "@/lib/billing/renewal-job";
import { sendExpiringCardNotices } from "@/lib/billing/notify";
import { DateTime } from "luxon";

async function studioToday(organizationId: string) {
  const { data } = await createSupabaseAdminClient().from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  return DateTime.now()
    .setZone((data?.timezone as string | null) ?? "America/Chicago")
    .toISODate()!;
}

// Nightly at 4 AM Houston (cron): charge the monthly dues due today and the
// retries due today, then send expiring-card emails (lib/billing/renewal-job.ts). A Club Admin can also run
// it for their own studio from Member Billing (test mode until renewals are
// switched on live).
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await createSupabaseAdminClient().from("stripe_connected_accounts").select("organization_id");
  const orgs = [...new Set((data ?? []).map((row) => row.organization_id as string))];
  const results: Record<string, unknown> = {};
  for (const org of orgs) {
    try {
      const renewals = await runRenewals(org);
      // Expiring-card emails go out once renewals are live (real members only).
      const expiringEmails = renewalsMayCharge(true) ? await sendExpiringCardNotices(org, await studioToday(org)) : 0;
      results[org] = { ...renewals, expiringEmails };
    } catch (error) {
      console.error("[billing/renewals]", org, error);
      results[org] = { error: error instanceof Error ? error.message : "Failed" };
    }
  }
  return NextResponse.json({ success: true, results });
}

export async function POST() {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const summary = await runRenewals(staff.organizationId);
  return NextResponse.json({ success: true, summary });
}
