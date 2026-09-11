import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadManageableStaff, revokeStaffLogin, wouldOrphanAdmins } from "@/lib/staff/lifecycle";

type RouteParams = { params: Promise<{ id: string }> };

// POST { archived: true }  -> hide a former instructor from the Staff
//                             Logins list and revoke their login.
// POST { archived: false } -> restore them to the list (login stays
//                             revoked; re-invite to give them access back).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: staffId } = await params;
    const currentStaff = await getCurrentStaff();
    const admin = createSupabaseAdminClient();

    const guard = await loadManageableStaff(admin, currentStaff, staffId);
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }
    const { target } = guard;

    const body = await request.json().catch(() => ({}));
    const archived = body?.archived !== false; // default to archiving

    if (archived) {
      if (await wouldOrphanAdmins(admin, currentStaff!.organizationId, target)) {
        return NextResponse.json(
          {
            success: false,
            error: `${target.display_name} is the only active admin -- promote someone else first.`,
          },
          { status: 409 },
        );
      }

      await revokeStaffLogin(admin, target.auth_user_id);

      const { error } = await admin
        .from("staff")
        .update({ archived_at: new Date().toISOString(), auth_user_id: null })
        .eq("id", staffId);

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ success: true, archived: true });
    }

    const { error } = await admin
      .from("staff")
      .update({ archived_at: null })
      .eq("id", staffId);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, archived: false });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
