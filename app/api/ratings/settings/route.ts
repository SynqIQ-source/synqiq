import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, requireClubAdminApi } from "@/lib/payroll/api";

// Club Admin: who gets class rating emails -- off, testers (member-portal
// testers only, during the parallel run) or everyone.
export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  const mode = body?.mode;
  if (mode !== "off" && mode !== "testers" && mode !== "everyone") return fail("Pick who gets rating emails.");
  const { error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({ ratings_mode: mode })
    .eq("id", auth.currentStaff.organizationId);
  if (error) return fail("Couldn't save. Try again.", 500);
  return NextResponse.json({ success: true });
}
