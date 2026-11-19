import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueMilestones } from "@/lib/email/milestones";

export const maxDuration = 300;

// Cron (vercel.json, after the visit syncs): queue class milestone emails for
// instructors to approve. Nothing is sent here.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient().from("milestone_templates").select("organization_id").eq("enabled", true);
  const results: Record<string, unknown> = {};
  for (const organizationId of new Set((orgs ?? []).map((row) => row.organization_id as string))) {
    try {
      results[organizationId] = await queueMilestones(organizationId);
    } catch (error) {
      console.error("[milestones] queue failed:", error);
      results[organizationId] = { error: true };
    }
  }
  return NextResponse.json({ success: true, results });
}
