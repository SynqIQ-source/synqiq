import { NextRequest, NextResponse } from "next/server";
import { requireCrmStaff } from "@/lib/crm/module";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CADENCE_LIMITS, DEFAULT_CADENCE, type FollowUpCadence } from "@/lib/crm/follow-ups";

// Club Admins set the studio's follow-up cadence (attempts, spacing, days
// before the warm pool). { reset: true } goes back to SynqIQ's default.
export async function PATCH(request: NextRequest) {
  const staff = await requireCrmStaff();
  if (staff.role !== "admin") return NextResponse.json({ success: false, error: "Only a Club Admin can change this." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as (Partial<Record<keyof FollowUpCadence, unknown>> & { reset?: boolean }) | null;
  if (!body) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });

  let cadence: FollowUpCadence | null = null;
  if (!body.reset) {
    cadence = { ...DEFAULT_CADENCE };
    for (const key of Object.keys(DEFAULT_CADENCE) as (keyof FollowUpCadence)[]) {
      const value = Number(body[key]);
      const [min, max] = CADENCE_LIMITS[key];
      if (!Number.isInteger(value) || value < min || value > max) {
        return NextResponse.json({ success: false, error: `Each number has to be between ${min} and ${max}.` }, { status: 400 });
      }
      cadence[key] = value;
    }
    if (cadence.dailyAttempts > cadence.attempts) cadence.dailyAttempts = cadence.attempts;
  }
  const { error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({ follow_up_cadence: cadence })
    .eq("id", staff.organizationId);
  if (error) return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  return NextResponse.json({ success: true });
}
