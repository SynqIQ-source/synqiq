import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Self-service opt-out from the every-4-days substitution reminder email.
// Admin client, not getScopedClient -- staff has no RLS UPDATE policy at
// all (same situation as /api/staff/me/profile), so this route's own
// "only your own row, only this one column" check is the real
// authorization boundary.
export async function PATCH(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const optOut: unknown = body?.optOut;

    if (typeof optOut !== "boolean") {
      return NextResponse.json({ error: "optOut must be a boolean." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("staff")
      .update({ substitution_reminder_opt_out: optOut })
      .eq("id", currentStaff.id)
      .select("id, substitution_reminder_opt_out")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update reminder preference.");
    }

    return NextResponse.json({ success: true, optOut: data.substitution_reminder_opt_out });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
